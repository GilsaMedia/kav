// Kav on the web: serves the app, the offline map and timetable, and speaks to Moovit for it.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startBackend, call, statusOf } from "../backend/routes.ts";
import type { Platform } from "../backend/platform.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const DIST = path.join(ROOT, "dist");
const MAP_ASSETS = path.join(ROOT, "..", "android", "app", "src", "main", "assets", "map");
const PORT = Number(process.env.PORT ?? 8443);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);

// ---- the backend, on Node --------------------------------------------------------------------

const STATE = path.join(DATA, "state.json");

const node: Platform = {
  request: (method, url, headers, body, timeoutMs = 25000) => new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: body ? { ...headers, "Content-Length": String(body.length) } : headers }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v != null) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        const all = Buffer.concat(chunks);
        resolve({ code: res.statusCode ?? 0, headers, body: new Uint8Array(all.buffer, all.byteOffset, all.byteLength) });
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  }),
  load: () => { try { return fs.readFileSync(STATE, "utf8"); } catch { return null; } },
  save: text => {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATE + ".tmp", text, { mode: 0o600 });
    fs.renameSync(STATE + ".tmp", STATE);
  },
};

console.log("loading the timetable…");
await startBackend(node, async () => fs.readFileSync(path.join(DATA, "il.kav")));
console.log("timetable loaded");

// ---- static files and the map ----------------------------------------------------------------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".pbf": "application/x-protobuf", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon", ".crt": "application/x-x509-ca-cert", ".mobileconfig": "application/x-apple-aspen-config",
};

function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, cache = "no-cache") {
  let st: fs.Stats;
  try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { res.writeHead(404).end("Not found"); return; }
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes", "Cache-Control": cache });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": cache });
  fs.createReadStream(file).pipe(res);
}

function inside(base: string, rel: string) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "https://kav.local");
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/api/")) {
    let body: any = {};
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
    }
    try {
      const out = await call(p.slice(5), url.searchParams, body);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
    } catch (e) {
      const err = e as Error & { title?: string };
      const status = statusOf(e);
      if (status >= 500) console.error(p, err.message);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message, title: err.title ?? null }));
    }
    return;
  }
  if (p === "/map/israel.pmtiles") return sendFile(req, res, path.join(DATA, "israel.pmtiles"), "max-age=31536000");
  if (p.startsWith("/map/")) { const f = inside(MAP_ASSETS, p.slice(5)); return f ? sendFile(req, res, f, "max-age=86400") : res.writeHead(404).end(); }
  if (p === "/kav-ca.crt") return sendFile(req, res, path.join(DATA, "certs", "ca.crt"));
  const f = p === "/" ? path.join(DIST, "index.html") : inside(DIST, p.slice(1));
  if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(req, res, f, p.startsWith("/assets/") ? "max-age=31536000, immutable" : "no-cache");
  // The app's own routes.
  return sendFile(req, res, path.join(DIST, "index.html"));
}

// ---- certificates: a small CA of this machine's own, installed once on the phone -------------

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a!.address);
}

function certificates() {
  const dir = path.join(DATA, "certs");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ca = path.join(dir, "ca.crt"), caKey = path.join(dir, "ca.key");
  const crt = path.join(dir, "server.crt"), key = path.join(dir, "server.key"), sans = path.join(dir, "sans.txt");
  const run = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  if (!fs.existsSync(ca)) {
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", ca, "-days", "3650",
      "-subj", `/CN=Kav local CA (${os.hostname()})`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
    fs.rmSync(crt, { force: true });
  }
  const want = ["DNS:localhost", `DNS:${os.hostname()}.local`, "IP:127.0.0.1", ...lanAddresses().map(a => `IP:${a}`)].join(",");
  if (!fs.existsSync(crt) || (fs.existsSync(sans) ? fs.readFileSync(sans, "utf8") : "") !== want) {
    const csr = path.join(dir, "server.csr"), ext = path.join(dir, "server.ext");
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-subj", "/CN=Kav");
    // iOS accepts server certificates of at most 825 days.
    fs.writeFileSync(ext, `subjectAltName=${want}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    run("x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-out", crt, "-days", "800", "-sha256", "-extfile", ext);
    fs.writeFileSync(sans, want);
    fs.rmSync(csr); fs.rmSync(ext);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---- start -----------------------------------------------------------------------------------

if (!fs.existsSync(path.join(DIST, "index.html"))) console.warn("dist/ is missing: run `npm run build` first");

const server = https.createServer(certificates(), (req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) res.writeHead(500).end(); }); });
server.listen(PORT, "0.0.0.0");

// Plain HTTP only hands out the CA and points at the HTTPS address.
http.createServer((req, res) => {
  const host = (req.headers.host ?? "localhost").replace(/:\d+$/, "");
  if (req.url === "/kav-ca.crt") return sendFile(req, res, path.join(DATA, "certs", "ca.crt"));
  const https_ = `https://${host}:${PORT}/`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kav setup</title><body style="font:17px -apple-system,system-ui;max-width:34em;margin:2em auto;padding:0 16px;line-height:1.5">
<h2>Set up Kav on this iPhone</h2><ol>
<li><a href="/kav-ca.crt">Download the Kav certificate</a> and tap <b>Allow</b>.</li>
<li>Open <b>Settings → General → VPN &amp; Device Management</b>, tap <b>Kav local CA</b>, and <b>Install</b>.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and turn on <b>Kav local CA</b>.</li>
<li>Open <a href="${https_}">${https_}</a>, then <b>Share → Add to Home Screen</b>.</li></ol></body>`);
}).listen(HTTP_PORT, "0.0.0.0");

console.log(`\nKav is running.`);
for (const a of lanAddresses()) console.log(`  on your iPhone, first time: http://${a}:${HTTP_PORT}/   then: https://${a}:${PORT}/`);
console.log(`  on this computer: https://localhost:${PORT}/`);
