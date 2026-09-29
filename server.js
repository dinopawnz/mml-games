// MML GAMES SERVER
// Serves every .html file in the "docs" folder as a live MML document.
//   docs/emberhold.html  ->  wss://<your-server>/emberhold
//   docs/cube.html       ->  wss://<your-server>/cube
// Open https://<your-server>/ in a browser to see the list of addresses.
// Built on the official MML starter project (mml-io/mml-starter-project).
import fs from "fs";
import path from "path";
import url from "url";
import express from "express";
import enableWs from "express-ws";
import { EditableNetworkedDOM, LocalObservableDOMFactory } from "@mml-io/networked-dom-server";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
const DOCS_DIR = path.resolve(dirname, "./docs");
const port = process.env.PORT || 8080;

// a file's address: its name, lower case, without ".html"
const nameOf = (file) => file.slice(0, -5).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

const documents = new Map();
for (const file of fs.readdirSync(DOCS_DIR)) {
  if (!file.toLowerCase().endsWith(".html")) continue;
  const filePath = path.join(DOCS_DIR, file);
  const name = nameOf(file);
  try {
    const doc = new EditableNetworkedDOM(url.pathToFileURL(filePath).toString(), LocalObservableDOMFactory);
    doc.load(fs.readFileSync(filePath, "utf8"));
    documents.set(name, doc);
    console.log(`serving ${file} at /${name}`);
  } catch (e) {
    console.error(`could not load ${file}:`, e);
  }
}

const { app } = enableWs(express());
app.enable("trust proxy");

// players (and host remotes) connect here
app.ws("/:name", (ws, req) => {
  const doc = documents.get(String(req.params.name).toLowerCase());
  if (!doc) { ws.close(); return; }
  doc.addWebSocket(ws);
  ws.on("close", () => doc.removeWebSocket(ws));
});

// a page listing every game's address
app.get("/", (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const rows = [...documents.keys()].map((n) => `<li><code>wss://${host}/${n}</code></li>`).join("");
  res.send(`<!doctype html><meta charset="utf-8"><title>MML games</title>
    <body style="font-family:system-ui;background:#111;color:#eee;padding:24px">
    <h1>MML games on this server</h1><p>Put these addresses into Otherside:</p><ul>${rows}</ul></body>`);
});
app.get("/healthz", (req, res) => res.send("ok"));

app.listen(port, () => console.log("listening on port", port));
