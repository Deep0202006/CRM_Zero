import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generatedOutput = join(repositoryRoot, ".next");
const buildId = join(generatedOutput, "BUILD_ID");

if (dirname(generatedOutput) !== repositoryRoot) {
  throw new Error(`Refusing to clean unexpected Next output: ${generatedOutput}`);
}

// Playwright runs immediately after `next build` in CI. Next 16.2.9 Turbopack's
// development compiler panics while compiling our route matrix, while running
// the already-verified production output is deterministic and avoids another
// build (including another external font fetch).
if (!existsSync(buildId)) {
  throw new Error(`Attendance E2E requires a completed Next build: ${buildId}`);
}

const nextCli = join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", "3111"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error("E2E server failed to start", error);
  process.exitCode = 1;
});

server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
