import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

// Set by the GitHub Pages workflow to "/<repo-name>/" for a project page (or "/" for a
// <user>.github.io root page) — see .github/workflows/deploy.yml. Left unset for local dev/build,
// where root-relative ("/") is correct.
const base = process.env.GITHUB_PAGES_BASE || "/";

export default defineConfig({
  base,
  plugins: [mkcert()],
  worker: {
    // Classic (non-module) worker output — module workers are fetched by the browser through a
    // path that service workers don't reliably intercept, even when the file is precached, which
    // broke offline capture with "unable to load a worker's module". Classic worker scripts don't
    // have that gap.
    format: "iife",
  },
  server: {
    // Binds to the LAN interface (not just localhost) so a phone on the same
    // network can load the dev server. HTTPS is required here — getUserMedia
    // is only permitted in a secure context, and a plain LAN IP over http
    // doesn't qualify, so mic access would silently fail without mkcert.
    host: true,
  },
  preview: {
    // Same reasoning as server.host above, for `vite preview` (the production-build server).
    host: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
