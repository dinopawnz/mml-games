// MML GAMES SERVER  v5
// v5: uses the oldest MML protocol (v0.1) first - the newest one crashed Otherside
// v4: connects properly with Otherside (protocol handshake) + newest MML server
// v3: also finds games in the main folder (next to server.js), not just docs/
// Serves every .html file in the "docs" folder as a live MML document.
//   docs/emberhold.html  ->  wss://<your-server>/emberhold
//   docs/cube.html       ->  wss://<your-server>/cube
// Open https://<your-server>/ in a browser to see the list of addresses.
// Built on the official MML starter project (mml-io/mml-starter-project).
//
// v2: GAMES ONLY RUN WHILE SOMEBODY IS IN THEM. A game starts the moment
// the first person (or host remote) connects, and goes back to sleep
// IDLE_MINUTES after the last one leaves - so twenty games on the server
// cost no more than the ones actually being played. When a game goes to
// sleep it forgets its state (scores, leaderboards, where a ship flew to),
// exactly as if you had restarted it locally.
//   IDLE_MINUTES  (Render "Environment" setting, default 20)
//   ALWAYS_ON     names that never sleep, comma separated, e.g. "emberhold,cube"
import fs from "fs";
import path from "path";
import url from "url";
import express from "express";
import enableWs from "express-ws";
import { EditableNetworkedDOM, LocalObservableDOMFactory, NetworkedDOM } from "@mml-io/networked-dom-server";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const DOCS_DIR = path.resolve(dirname, "./docs");
const port = process.env.PORT || 8080;
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES || 20);
const ALWAYS_ON = new Set((process.env.ALWAYS_ON || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

// a file's address: its name, lower case, without ".html"
const nameOf = (file) => file.slice(0, -5).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

// every game (name -> file): the .html files in docs/, and (v3) any in the main folder
// too, so it still works if GitHub put them there. A name in docs/ wins.
const files = new Map();
for (const dir of [DOCS_DIR, dirname]) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.toLowerCase().endsWith(".html")) continue;
    const name = nameOf(file);
    if (files.has(name)) continue;
    files.set(name, path.join(dir, file));
    console.log(`found ${path.relative(dirname, path.join(dir, file))} -> /${name}`);
  }
}
if (!files.size) console.error("NO GAMES FOUND - put your game .html files in the docs folder (or next to server.js)");

// the games that are running right now (name -> { doc, sockets, timer })
const live = new Map();
function wake(name) {
  const filePath = files.get(name);
  if (!filePath) return null;
  try {
    const doc = new EditableNetworkedDOM(url.pathToFileURL(filePath).toString(), LocalObservableDOMFactory);
    doc.load(fs.readFileSync(filePath, "utf8"));
    const g = { doc, sockets: new Set(), timer: null };
    live.set(name, g);
    console.log(`started /${name}`);
    return g;
  } catch (e) {
    console.error(`could not start /${name}:`, e);
    return null;
  }
}
function sleep(name) {
  const g = live.get(name);
  if (!g || g.sockets.size) return;
  live.delete(name);
  try { if (typeof g.doc.dispose === "function") g.doc.dispose(); } catch (e) { console.error(`stopping /${name}:`, e); }
  console.log(`stopped /${name} (nobody there for ${IDLE_MINUTES} min)`);
}
for (const name of ALWAYS_ON) if (files.has(name)) wake(name);

// v5: agree on the connection's protocol with the client. Otherside's in-world (Unreal)
// client offers the newest protocol too, but crashes on it - so the OLDEST one it offers,
// networked-dom-v0.1 (plain JSON, what every MML client supports), is picked first.
// To try another order, set PROTOCOLS on Render, e.g. "networked-dom-v0.2.1,networked-dom-v0.1".
const PROTOCOLS = (process.env.PROTOCOLS || "networked-dom-v0.1,networked-dom-v0.2,networked-dom-v0.2.1")
  .split(",").map((s) => s.trim()).filter(Boolean);
function pickProtocol(offered) {
  const set = new Set(offered);
  for (const p of PROTOCOLS) if (set.has(p)) return p;
  return NetworkedDOM.handleWebsocketSubprotocol(set);   // something else we still understand
}
const { app } = enableWs(express(), undefined, { wsOptions: { handleProtocols: pickProtocol } });
app.enable("trust proxy");

// players (and host remotes) connect here
app.ws("/:name", (ws, req) => {
  const name = String(req.params.name).toLowerCase();
  const g = live.get(name) || wake(name);
  if (!g) { ws.close(); return; }
  clearTimeout(g.timer); g.timer = null;
  g.sockets.add(ws);
  g.doc.addWebSocket(ws);
  console.log(`join /${name} (${ws.protocol || "no protocol"}), ${g.sockets.size} connected`);
  ws.on("close", () => {
    try { g.doc.removeWebSocket(ws); } catch (e) {}
    g.sockets.delete(ws);
    if (g.sockets.size === 0 && !ALWAYS_ON.has(name)) {
      clearTimeout(g.timer);
      g.timer = setTimeout(() => sleep(name), IDLE_MINUTES * 60000);
    }
  });
});

// a page listing every game's address
app.get("/", (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const rows = [...files.keys()].map((n) => {
    const g = live.get(n);
    const st = g ? `running, ${g.sockets.size} connected` : "asleep (starts when someone joins)";
    return `<li><code>wss://${host}/${n}</code> <span style="color:#888">- ${st}</span></li>`;
  }).join("");
  res.send(`<!doctype html><meta charset="utf-8"><title>MML games</title>
    <body style="font-family:system-ui;background:#111;color:#eee;padding:24px;line-height:1.7">
    <h1>MML games on this server</h1><p>Put these addresses into Otherside:</p><ul>${rows}</ul></body>`);
});
app.get("/healthz", (req, res) => res.send("ok"));

app.listen(port, () => console.log("listening on port", port));
