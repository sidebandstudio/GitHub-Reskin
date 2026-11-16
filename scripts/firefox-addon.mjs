// Firefox's remote debugging protocol, for a temporary add-on's own pages, which Playwright cannot
// open. remoteClient speaks the protocol, attachAddon reaches an installed add-on's frames, and
// pickTheme commits a theme from the add-on's popup as a person would there. qa:firefox, qa:live
// and the installed-add-on tests share them.
import net from "node:net";
import { writeFile } from "node:fs/promises";

/**
 * A Firefox remote debugging client: request(packet) resolves with the reply from packet.to, or
 * rejects after `ms`, and on(listener) sees every packet, including events. When the connection
 * closes, pending requests reject and listeners see {type: "connection-closed"}. A run stops on a
 * timeout, since a late reply would answer the next request to that actor.
 */
export function remoteClient(port, { host = "127.0.0.1", ms = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    const waiting = new Map();
    const listeners = new Set();
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const greeting = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Firefox's debugging server did not greet within ${ms / 1000} s`));
    }, ms);
    const client = {
      request(packet) {
        return new Promise((done, fail) => {
          const entry = { done, fail };
          entry.timer = setTimeout(() => {
            const queue = waiting.get(packet.to) ?? [];
            queue.splice(queue.indexOf(entry), 1);
            fail(new Error(`Firefox did not answer ${packet.type} within ${ms / 1000} s`));
          }, ms);
          waiting.set(packet.to, [...(waiting.get(packet.to) ?? []), entry]);
          const body = Buffer.from(JSON.stringify(packet));
          socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
        });
      },
      on(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => socket.destroy(),
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(":");
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (buffer.length < colon + 1 + length) return;
        const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
        buffer = buffer.subarray(colon + 1 + length);
        if (!greeted) {
          greeted = true;
          clearTimeout(greeting);
          resolve(client);
          continue;
        }
        for (const listener of listeners) listener(packet);
        // Events carry a type; a reply has none, or carries an error.
        const queue = waiting.get(packet.from);
        if (queue?.length && (!packet.type || packet.error)) {
          const { done, fail, timer } = queue.shift();
          clearTimeout(timer);
          if (packet.error) fail(new Error(`${packet.error}: ${packet.message}`));
          else done(packet);
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(greeting);
      reject(error);
    });
    socket.on("close", () => {
      for (const queue of waiting.values())
        for (const { fail, timer } of queue) {
          clearTimeout(timer);
          fail(new Error("Firefox closed the debugging connection"));
        }
      waiting.clear();
      for (const listener of listeners) listener({ type: "connection-closed" });
    });
  });
}

/** A client of the debugging server on `port`, retrying while Firefox starts it. */
export async function connect(port) {
  const end = Date.now() + 30000;
  for (;;) {
    try {
      return await remoteClient(port, { ms: 10000 });
    } catch (error) {
      if (Date.now() > end) throw new Error(`Firefox's debugging server never answered on port ${port}: ${error.message}`);
      await wait(200);
    }
  }
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls `check` until it returns a truthy value or `ms` pass, and returns the last value. */
export async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  let value;
  while (!(value = await check()) && Date.now() < end) await wait(250);
  return value;
}

/**
 * The installed add-on `id`'s frames: evaluate(match, fn, ...args) runs fn in the newest frame
 * whose URL contains `match` and resolves with its JSON result, screenshot(match, path)
 * photographs that tab, frame(match) waits for it, and problems collects the errors and CSP
 * reports from the add-on's own pages and background.
 */
export async function attachAddon(client, id) {
  const root = await client.request({ to: "root", type: "getRoot" });
  const addon = await until(async () => (await client.request({ to: "root", type: "listAddons" })).addons.find((entry) => entry.id === id));
  if (!addon) throw new Error(`Firefox lists no add-on ${id}`);
  const watcher = await client.request({ to: addon.actor, type: "getWatcher" });
  const frames = [];
  const problems = [];
  client.on((packet) => {
    if (packet.type === "target-available-form") frames.push(packet.target);
    const gone = packet.type === "target-destroyed-form" ? frames.findIndex((form) => form.actor === packet.target.actor) : -1;
    if (gone >= 0) frames.splice(gone, 1);
    if (packet.type === "resources-available-array")
      for (const [kind, resources] of packet.array ?? [])
        for (const { pageError } of kind === "error-message" ? resources : [])
          if (pageError && (!pageError.warning || /CSP/i.test(pageError.category ?? ""))) problems.push(`${pageError.category ?? ""} ${pageError.errorMessage} (${pageError.sourceName ?? ""})`.trim());
  });
  await client.request({ to: watcher.actor, type: "watchTargets", targetType: "frame" });
  await client.request({ to: watcher.actor, type: "watchResources", resourceTypes: ["error-message"] });
  const frame = (match) => until(async () => frames.findLast((form) => form.url?.includes(match)));
  const evaluate = async (match, fn, ...args) => {
    const form = await frame(match);
    if (!form) throw new Error(`no add-on frame at ${match}`);
    let off = () => {};
    let timer;
    // The value arrives as its own event, which a closed connection or page never sends.
    const result = new Promise((resolve, reject) => {
      off = client.on((packet) => {
        if (packet.type === "evaluationResult" && packet.from === form.consoleActor) resolve(packet);
        else if (packet.type === "connection-closed") reject(new Error("Firefox closed the debugging connection"));
        else if (packet.type === "target-destroyed-form" && packet.target?.actor === form.actor) reject(new Error(`${match} closed during an evaluation`));
      });
      timer = setTimeout(() => reject(new Error(`Evaluating in ${match} took longer than 30 s`)), 30000);
    });
    // Handled now, so a disconnect while the request is pending leaves no unhandled rejection.
    result.catch(() => {});
    try {
      await client.request({ to: form.consoleActor, type: "evaluateJSAsync", text: `(async () => JSON.stringify(await (${fn})(...${JSON.stringify(args)})))()`, mapped: { await: true } });
      const packet = await result;
      if (packet.exceptionMessage) throw new Error(`${match}: ${packet.exceptionMessage}`);
      return typeof packet.result === "string" ? JSON.parse(packet.result) : undefined;
    } finally {
      clearTimeout(timer);
      off();
    }
  };
  const screenshot = async (match, path) => {
    const form = await frame(match);
    const { value } = await client.request({ to: root.screenshotActor, type: "capture", args: { browsingContextID: form.browsingContextID, rect: { left: 0, top: 0, width: 1280, height: 800 }, dpr: 1, snapshotScale: 1, fileScale: 1 } });
    if (!value?.data) throw new Error(`no screenshot of ${match}: ${JSON.stringify(value?.messages)}`);
    await writeFile(path, Buffer.from(value.data.split(",")[1], "base64"));
  };
  return { evaluate, screenshot, frame, problems };
}

/**
 * Picks a theme in the add-on attached as `addon`, from a popup tab its background opens, then
 * closes that tab. A new install has no theme; the installed-add-on checks pick one first.
 */
export async function pickTheme(addon, themeId) {
  const tab = await addon.evaluate("_generated_background_page", () => browser.tabs.create({ url: browser.runtime.getURL("pages/popup.html"), active: false }).then((created) => created.id));
  const reply = await addon.evaluate(
    "pages/popup.html",
    async (id) => {
      const got = await browser.runtime.sendMessage({ type: "get", requestId: "pick-get" });
      return browser.runtime.sendMessage({ type: "commit", requestId: "pick-commit", expectedRevision: got.settings.revision, action: { type: "selectTheme", id } });
    },
    themeId,
  );
  await addon.evaluate("_generated_background_page", (id) => browser.tabs.remove(id).then(() => true), tab);
  if (!reply?.ok) throw new Error(`Picking ${themeId} failed: ${JSON.stringify(reply)}`);
  return reply.settings;
}
