import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";

const outputDir = "dist";
const deployPublicDir = "site-deploy/public";
const bundle = await readFile("data/dashboard_bundle.js", "utf8");
const asOf = bundle.match(/"as_of":"([^"]+)"/)?.[1];
if (!asOf) throw new Error("data/dashboard_bundle.js is missing meta.as_of");

const dataScripts = (await readdir("data"))
  .filter(name => /^dashboard_.*\.js$/i.test(name))
  .sort();

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir + "/data", { recursive: true });
await mkdir(deployPublicDir + "/data", { recursive: true });

const existingDeployData = await readdir(deployPublicDir + "/data").catch(() => []);
await Promise.all(existingDeployData
  .filter(name => /^dashboard_.*\.js$/i.test(name))
  .map(name => rm(deployPublicDir + "/data/" + name, { force: true })));

await Promise.all([
  cp("dashboard.html", outputDir + "/index.html"),
  cp("dashboard.html", outputDir + "/dashboard.html"),
  cp("assets", outputDir + "/assets", { recursive: true }),
  cp("dashboard.html", deployPublicDir + "/dashboard.html"),
  cp("assets", deployPublicDir + "/assets", { recursive: true }),
  ...dataScripts.flatMap(name => [
    cp("data/" + name, outputDir + "/data/" + name),
    cp("data/" + name, deployPublicDir + "/data/" + name)
  ])
]);

console.log("Static site built and deployment public assets synchronized; T-1=" + asOf);