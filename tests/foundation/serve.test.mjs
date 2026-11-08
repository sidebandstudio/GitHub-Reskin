import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { serve } from "../../scripts/serve.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

// Sends the path as written, so ../ segments reach the server unnormalized.
const get = (port, path, method = "GET") =>
  new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk)).on("end", () => done({ status: res.statusCode, type: res.headers["content-type"], body }));
    });
    req.on("error", fail).end();
  });

test("the fixture server serves built files with their types, on a free port, until closed", async () => {
  await withTempDir(async (tmp) => {
    const root = join(tmp, "site");
    await mkdir(join(root, "themes"), { recursive: true });
    await writeFile(join(root, "index.html"), "<h1>home</h1>");
    await writeFile(join(root, "themes", "index.html"), "<h1>themes</h1>");
    await writeFile(join(root, "app.js"), "export {};");
    await writeFile(join(root, ".env"), "SECRET=1");
    await writeFile(join(tmp, "outside.txt"), "outside");
    await symlink(join(tmp, "outside.txt"), join(root, "link.txt"));

    const server = await serve({ root, host: "127.0.0.1" });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.ok(server.port > 0);
      assert.deepEqual(await get(server.port, "/"), { status: 200, type: "text/html; charset=utf-8", body: "<h1>home</h1>" });
      assert.equal((await get(server.port, "/themes/")).body, "<h1>themes</h1>");
      assert.equal((await get(server.port, "/app.js")).type, "text/javascript; charset=utf-8");
      assert.equal((await get(server.port, "/app.js", "HEAD")).body, "");
      for (const path of ["/missing", "/.env", "/../outside.txt", "/%2e%2e/outside.txt", "/link.txt", "/themes/..%2f..%2foutside.txt"]) {
        assert.equal((await get(server.port, path)).status, 404, path);
      }
      assert.equal((await get(server.port, "/", "POST")).status, 405);
    } finally {
      await server.close();
    }
    await assert.rejects(get(server.port, "/"));
  });
});

test("with a base path, only paths under it are served", async () => {
  await withTempDir(async (tmp) => {
    await writeFile(join(tmp, "index.html"), "home");
    const server = await serve({ root: tmp, host: "127.0.0.1", base: "/GitHub-Reskin/" });
    try {
      assert.match(server.url, /\/GitHub-Reskin\/$/);
      assert.equal((await get(server.port, "/GitHub-Reskin/")).body, "home");
      assert.equal((await get(server.port, "/GitHub-Reskin")).body, "home");
      assert.equal((await get(server.port, "/")).status, 404);
      assert.equal((await get(server.port, "/GitHub-ReskinX/")).status, 404);
    } finally {
      await server.close();
    }
  });
});
