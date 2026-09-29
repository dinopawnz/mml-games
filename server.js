// MML GAMES SERVER  v6
// Serves every .html game in this folder (and in docs/, if there is one) as a live MML
// document - the same way the official MML tool does on your computer (`mml serve-dir`,
// version 0.26.1): same MML engine, same websocket library (ws 8), same protocol choice,
// same document settings.
//
// ADDRESSES: the file name, exactly as on your computer with ngrok:
//   Emberhold_v29.html  ->  wss://<your-server>/Emberhold_v29.html
// and also a short lower-case name without ".html":  wss://<your-server>/emberhold_v29
// Open https://<your-server>/ in a browser to see them all.
//
// A game starts when the first person connects and stops IDLE_MINUTES after the last
// one leaves (it forgets its state then). IDLE_MINUTES and ALWAYS_ON ("emberhold.html,cube.html")
// can be set in Render's Environment settings.
import fs from "fs";
import http from "http";
import path from "path";
import url from "url";
import { WebSocketServer } from "ws";
import { EditableNetworkedDOM, LocalObservableDOMFactory, NetworkedDOM } from "@mml-io/networked-dom-server";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 10000);
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES || 20);
const ALWAYS_ON = new Set((process.env.ALWAYS_ON || "").split(",").map((s) => s.trim()).filter(Boolean));

// ---- the games: every .html in this folder and in docs/
const games = new Map();   // file name -> { file, doc, sockets, timer }
const alias = new Map();   // any accepted address -> file name
for (const dir of [dirname, path.join(dirname, "docs")]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.html?$/i.test(f) || games.has(f)) continue;
    games.set(f, { file: path.join(dir, f), doc: null, sockets: new Set(), timer: null });
    alias.set(f, f);
    const short = f.replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!alias.has(short)) alias.set(short, f);
    console.log(`Document added: ${f}`);
  }
}
if (!games.size) console.error("NO GAMES FOUND - put your .html games next to server.js");

function start(g, name) {
  if (g.doc) return g.doc;
  console.log(`Loading document ${name}`);
  // exactly as `mml serve-dir`: third argument false = keep text nodes
  g.doc = new EditableNetworkedDOM(url.pathToFileURL(g.file).toString(), LocalObservableDOMFactory, false);
  g.doc.load(fs.readFileSync(g.file, "utf8"));
  return g.doc;
}
function stop(g, name) {
  if (!g.doc || g.sockets.size) return;
  console.log(`Stopping document ${name} due to no connections`);
  try { g.doc.dispose(); } catch (e) { console.error(e); }
  g.doc = null;
}
for (const n of ALWAYS_ON) { const f = alias.get(n); if (f) start(games.get(f), f); }

// ---- web pages: "/" lists the addresses (Render also uses it as its health check)
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/healthz") { res.end("ok"); return; }
  if (p === "/") {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const rows = [...games.entries()].map(([f, g]) =>
      `<li><code>wss://${host}/${f}</code> <span style="color:#888">- ${g.doc ? "running, " + g.sockets.size + " connected" : "asleep"}</span></li>`).join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(`<!doctype html><meta charset="utf-8"><title>MML games</title><body style="font-family:system-ui;background:#111;color:#eee;padding:24px;line-height:1.7"><h1>MML games on this server</h1><p>Put these addresses into Otherside:</p><ul>${rows}</ul></body>`);
    return;
  }
  res.writeHead(404); res.end("not found");
});

// ---- the game connections (ws 8, protocol picked exactly as `mml serve-dir` does)
const wss = new WebSocketServer({ noServer: true, handleProtocols: NetworkedDOM.handleWebsocketSubprotocol });
server.on("upgrade", (req, socket, head) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+|\/+$/g, "");
  const f = alias.get(p) || alias.get(p.toLowerCase());
  if (!f) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const g = games.get(f);
    clearTimeout(g.timer); g.timer = null;
    g.sockets.add(ws);
    const doc = start(g, f);
    doc.addWebSocket(ws);
    console.log(`join ${f} (${ws.protocol || "no protocol"}), ${g.sockets.size} connected`);
    ws.on("close", () => {
      try { doc.removeWebSocket(ws); } catch (e) {}
      g.sockets.delete(ws);
      if (!g.sockets.size && !ALWAYS_ON.has(f)) g.timer = setTimeout(() => stop(g, f), IDLE_MINUTES * 60000);
    });
  });
});

server.listen(port, "0.0.0.0", () => console.log(`Serving ${games.size} games on port ${port}`));
