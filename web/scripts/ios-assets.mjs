// What the iOS app carries beyond the web build: the map's style, fonts and sprites, and the timetable.
import fs from "node:fs";
import path from "node:path";

const web = path.join(import.meta.dirname, "..");
const dist = path.join(web, "dist");
const mapAssets = path.join(web, "..", "android", "app", "src", "main", "assets", "map");
const timetable = path.join(web, "data", "il.kav.gz");

if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("Run `vite build` first");
if (!fs.existsSync(timetable)) throw new Error("data/il.kav.gz is missing: run ./setup.sh, or tools/fetch.sh and the bundle export");

fs.cpSync(mapAssets, path.join(dist, "map"), { recursive: true });
fs.copyFileSync(timetable, path.join(dist, "il.kav.gz"));
const mb = fs.statSync(timetable).size / 1e6;
console.log(`map style and fonts copied; timetable ${mb.toFixed(1)} MB copied`);
