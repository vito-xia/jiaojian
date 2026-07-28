import { cp, mkdir, rm } from "node:fs/promises";

const outputDir = "dist";

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all([
  cp("dashboard.html", `${outputDir}/index.html`),
  cp("dashboard.html", `${outputDir}/dashboard.html`),
  cp("assets", `${outputDir}/assets`, { recursive: true }),
  cp("data/dashboard_bundle.js", `${outputDir}/data/dashboard_bundle.js`),
]);

console.log("Cloudflare Pages static site built in dist/");
