import { cp, mkdir, readFile, rm } from "node:fs/promises";

const outputDir = "dist";
const deployPublicDir = "site-deploy/public";
const bundle = await readFile("data/dashboard_bundle.js", "utf8");
const asOf = bundle.match(/"as_of":"([^"]+)"/)?.[1];
if (!asOf) throw new Error("data/dashboard_bundle.js is missing meta.as_of");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all([
  cp("dashboard.html", outputDir + "/index.html"),
  cp("dashboard.html", outputDir + "/dashboard.html"),
  cp("assets", outputDir + "/assets", { recursive: true }),
  cp("data/dashboard_bundle.js", outputDir + "/data/dashboard_bundle.js"),
  cp("dashboard.html", deployPublicDir + "/dashboard.html"),
  cp("assets", deployPublicDir + "/assets", { recursive: true }),
  cp("data/dashboard_bundle.js", deployPublicDir + "/data/dashboard_bundle.js"),
]);

console.log("Static site built and deployment public assets synchronized; T-1=" + asOf);