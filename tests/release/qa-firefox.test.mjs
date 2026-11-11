// scripts/qa-firefox.mjs without a browser: which Firefox it uses, the hand procedure it prints,
// refusing to pass without a Firefox, and its remote debugging client's packet handling against a
// local stand-in server. The run itself is npm run qa:firefox.
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { findFirefox, procedure, qaFirefox, remoteClient } from "../../scripts/qa-firefox.mjs";

test("the Firefox comes from --firefox, then RESKIN_FIREFOX, then the usual install path", () => {
  const exists = (path) => path.startsWith("C:");
  assert.equal(findFirefox(["--firefox", "C:/ff/firefox.exe"], { RESKIN_FIREFOX: "C:/other.exe" }, exists), "C:/ff/firefox.exe");
  assert.equal(findFirefox([], { RESKIN_FIREFOX: "C:/other.exe" }, exists), "C:/other.exe");
  assert.equal(findFirefox(["--firefox", "Z:/missing.exe"], {}, exists), null, "a given path that is missing is not replaced by a guess");
  assert.equal(findFirefox([], {}, () => false), null);
});

test("the printed procedure names the package, the Firefox and web-ext's temporary profile", () => {
  const text = procedure({ firefoxPath: "C:/ff/firefox.exe", zip: "artifacts/github-reskin-9.9.9-firefox.zip" });
  assert.match(text, /artifacts\/github-reskin-9\.9\.9-firefox\.zip/);
  assert.match(text, /web-ext run --source-dir .* --firefox "C:\/ff\/firefox\.exe"/);
  assert.match(text, /temporary add-on/);
});

test("without a Firefox, qa:firefox fails and says how to run it", async () => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(line);
  try {
    assert.deepEqual(await qaFirefox({ args: ["--firefox", "Z:/no/such/firefox.exe"] }), { exitCode: 1, testCount: 0 });
  } finally {
    console.error = error;
  }
  assert.match(lines.join("\n"), /needs an actual Firefox release/);
  assert.match(lines.join("\n"), /web-ext run/);
});

test("the remote client pairs replies with requests by actor, passes events on and rejects errors", async () => {
  const server = net.createServer((socket) => {
    const send = (packet) => {
      const body = Buffer.from(JSON.stringify(packet));
      return Buffer.concat([Buffer.from(`${body.length}:`), body]);
    };
    socket.write(send({ from: "root", applicationType: "browser" }));
    socket.on("data", (chunk) => {
      const packet = JSON.parse(chunk.toString().slice(chunk.indexOf(":") + 1));
      if (packet.type === "evaluateJSAsync") {
        // The reply and the event arrive in one chunk, the event split across two writes.
        const both = Buffer.concat([send({ from: packet.to, resultID: "1" }), send({ from: packet.to, type: "evaluationResult", resultID: "1", result: "42" })]);
        socket.write(both.subarray(0, both.length - 5));
        setTimeout(() => socket.write(both.subarray(both.length - 5)), 20);
      } else socket.write(send({ from: packet.to, error: "unrecognizedPacketType", message: "no" }));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const client = await remoteClient(server.address().port);
  try {
    const event = new Promise((resolve) => client.on((packet) => packet.type === "evaluationResult" && resolve(packet)));
    assert.deepEqual(await client.request({ to: "console1", type: "evaluateJSAsync", text: "6 * 7" }), { from: "console1", resultID: "1" });
    assert.equal((await event).result, "42");
    await assert.rejects(client.request({ to: "root", type: "nonsense" }), /unrecognizedPacketType: no/);
  } finally {
    client.close();
    server.close();
  }
});
