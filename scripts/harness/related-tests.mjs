import { changedPaths, configPath, logList, matchesPath, readJson, run } from "./common.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--run");
const config = readJson(configPath);
const files = changedPaths();
const domains = Object.entries(config.domains).filter(([, d]) => files.some((file) => d.codePaths.some((path) => matchesPath(file, path)) || file === d.contract));
const tests = [...new Set(domains.flatMap(([, d]) => d.tests))].sort();
logList("Related domains", domains.map(([name]) => name));
logList("Related tests", tests);
if (execute && tests.length) run("npm", ["test", "--", "--runInBand", "--runTestsByPath", ...tests]);
else if (execute) console.log("No domain tests selected; no Jest invocation needed.");
