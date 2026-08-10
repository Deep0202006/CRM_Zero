import { changedPaths, matchesPath, readJson, configPath } from "./common.mjs";

const files = changedPaths();
const config = readJson(configPath);
const domains = Object.entries(config.domains).filter(([, d]) => files.some((file) => d.codePaths.some((path) => matchesPath(file, path)))).map(([name]) => name);
let risk = "R0";
if (files.some((f) => f === "src/context/AuthContext.tsx" || f.startsWith("supabase/") || /auth|middleware/.test(f))) risk = "R3";
else if (domains.some((d) => ["calls", "field-visits", "followups", "attendance", "team-kpi", "pipeline", "mappings", "queries"].includes(d))) risk = "R2";
else if (files.some((f) => f.startsWith("src/"))) risk = "R1";
console.log(JSON.stringify({ risk, domains, files }, null, 2));
