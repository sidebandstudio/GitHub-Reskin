// Static server for built output and test fixtures. Playwright projects and manual previews use
// it the same way: serve({ root }) binds 0.0.0.0 on a free port and returns { url, port, close }.
// Files outside root, dotfiles and directory listings are never served. A directory serves its
// index.html. With base (for example /GitHub-Reskin), only paths under it are served.
// Run: node scripts/serve.mjs <dir> [--port 0] [--host 0.0.0.0] [--base /GitHub-Reskin]
import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
};

export async function serve({ root, host = "0.0.0.0", port = 0, base = "" }) {
  const dir = realpathSync(resolve(root));
  const prefix = base.replace(/\/+$/, "");

  async function find(pathname) {
    if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
    const parts = decodeURIComponent(pathname.slice(prefix.length)).split("/").filter(Boolean);
    if (parts.some((part) => part.startsWith(".") || part.includes("\\") || part.includes("\0"))) return null;
    let file = join(dir, ...parts);
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, "index.html");
    else if (!info?.isFile()) return null;
    // A symlink may not lead out of root.
    let real;
    try {
      real = realpathSync(file);
    } catch {
      return null;
    }
    return real.startsWith(dir + sep) ? real : null;
  }

  const server = createServer(async (req, res) => {
    let file = null;
    try {
      if (req.method === "GET" || req.method === "HEAD") file = await find(new URL(req.url, "http://localhost").pathname);
    } catch {}
    if (!file) {
      res.writeHead(req.method === "GET" || req.method === "HEAD" ? 404 : 405, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found\n");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise((done, fail) => server.once("error", fail).listen(port, host, done));
  const actual = server.address().port;
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    port: actual,
    url: `http://${shown}:${actual}${prefix}/`,
    close: () => new Promise((done) => server.close(done)),
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { port: { type: "string", default: "0" }, host: { type: "string", default: "0.0.0.0" }, base: { type: "string", default: "" } },
  });
  if (positionals.length !== 1) {
    console.error("Usage: node scripts/serve.mjs <dir> [--port 0] [--host 0.0.0.0] [--base /GitHub-Reskin]");
    process.exit(1);
  }
  const { url } = await serve({ root: positionals[0], host: values.host, port: Number(values.port), base: values.base });
  console.log(`Serving ${positionals[0]} at ${url} (bound to ${values.host})`);
}
