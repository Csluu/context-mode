import { spawnSync } from "node:child_process";

const defaults = {
  COMPETITOR_SAMPLES: "1",
  COMPETITOR_TOOLS: "fork,fork-intent",
  COMPETITOR_WORKFLOWS: [
    "bash-compression-suite",
    "binary-handling",
    "ansi-stripping",
    "stderr-heavy",
    "real-ci-log",
    "search-corpus",
    "sidecar-replay",
    "restart-cache",
  ].join(","),
};

const env = { ...process.env };
for (const [key, value] of Object.entries(defaults)) {
  if (!env[key]) env[key] = value;
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, scriptName) {
  console.log(`[competitor-quick] ${label}`);
  const result = process.platform === "win32"
    ? spawnSync(`${npm} run ${scriptName}`, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: true,
    })
    : spawnSync(npm, ["run", scriptName], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
  if (result.error) {
    console.error(`[competitor-quick] ${label} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[competitor-quick] ${label} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[competitor-quick] tools=${env.COMPETITOR_TOOLS}`);
console.log(`[competitor-quick] workflows=${env.COMPETITOR_WORKFLOWS}`);
run("baseline", "compare:competitors:run");
run("report", "compare:competitors:report");
