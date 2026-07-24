// Runs after `vite build`: walks dist/ for the real (hashed) output filenames and writes them
// into dist/sw.js's precache list, so the service worker can cache the actual app shell on
// install instead of only caching whatever happens to be fetched live later. Also computes a
// content hash across every precached file to use as the cache name/version — Vite's own
// per-file hashes cover the JS/CSS bundles, but static files copied verbatim from public/ (icons,
// manifest.webmanifest) keep the same filename even when their bytes change, so hashing names
// alone would miss those. This makes every deploy that changes anything get a fresh cache name.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DIST_DIR = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const URLS_PLACEHOLDER = "self.__PRECACHE_URLS__ || []";
const VERSION_PLACEHOLDER = 'self.__CACHE_VERSION__ || "dev"';
// Same env var vite.config.ts reads — keeps precache URLs consistent with wherever this build
// actually gets deployed (e.g. "/voice-trainer/" for a GitHub Pages project page).
const BASE = process.env.GITHUB_PAGES_BASE || "/";

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === ".vite") continue; // build metadata, not served/needed at runtime
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const absoluteFiles = walk(DIST_DIR).filter((f) => relative(DIST_DIR, f) !== "sw.js");
const urls = absoluteFiles
  .map((f) => relative(DIST_DIR, f).split(sep).join("/"))
  .map((rel) => (rel === "index.html" ? "" : rel))
  .map((rel) => BASE + rel)
  .sort();

const hash = createHash("sha256");
for (const f of [...absoluteFiles].sort()) {
  hash.update(relative(DIST_DIR, f));
  hash.update(readFileSync(f));
}
const version = hash.digest("hex").slice(0, 10);

const swPath = join(DIST_DIR, "sw.js");
let swSource = readFileSync(swPath, "utf8");
for (const [placeholder, value] of [
  [URLS_PLACEHOLDER, JSON.stringify(urls)],
  [VERSION_PLACEHOLDER, JSON.stringify(version)],
]) {
  if (!swSource.includes(placeholder)) {
    throw new Error(`inject-precache: placeholder ${JSON.stringify(placeholder)} not found in dist/sw.js — did public/sw.js change?`);
  }
  swSource = swSource.replace(placeholder, value);
}
writeFileSync(swPath, swSource);
console.log(`inject-precache: cache version ${version}, precaching ${urls.length} files:`, urls);
