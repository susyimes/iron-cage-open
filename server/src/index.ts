import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachRooms } from "./rooms.ts";

const port = Number(process.env.PORT ?? 43154);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = process.env.CLIENT_DIST ?? path.resolve(here, "../../client/dist");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(dist, rel);
    const relative = path.relative(path.resolve(dist), file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    const ext = path.extname(file);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
    };
    res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

attachRooms(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`iron-cage online http://127.0.0.1:${port}`);
});
