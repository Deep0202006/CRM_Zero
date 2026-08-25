import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const run = (...args) =>
  execFileSync("node", ["scripts/engineering/context.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
const parsed = (...args) => JSON.parse(run(...args));
const cases = [
  [
    "ERP",
    ["--path", "src/components/visits/CurrentErpBaselineEditor.tsx"],
    "erp",
  ],
  [
    "Master import",
    ["--path", "src/app/api/distributors/master-import/route.ts"],
    "imports",
  ],
  [
    "Receivables",
    ["--path", "src/app/api/receivables/commands/route.ts"],
    "receivables",
  ],
  ["Pipeline", ["--path", "src/app/api/pipeline/create/route.ts"], "pipeline"],
  ["Calls", ["--path", "src/app/api/call-logs/confirm/route.ts"], "calls"],
  [
    "Visits",
    ["--path", "src/app/api/field-visits/confirm/route.ts"],
    "field-visits",
  ],
  ["Mappings", ["--path", "src/app/mappings/page.tsx"], "mappings"],
  ["Support", ["--path", "src/app/support/page.tsx"], "queries"],
  [
    "Followups",
    ["--path", "src/app/api/my-day/payment-followups/route.ts"],
    "followups",
  ],
  ["Chat", ["--path", "src/app/api/chat/messages/route.ts"], "team-chat"],
  ["KPI", ["--path", "src/app/api/team-kpi/route.ts"], "team-kpi"],
  ["Tasks", ["--path", "src/app/api/task-upload/route.ts"], "task-allocation"],
];
for (const [name, args, domain] of cases) {
  const pack = parsed(...args);
  if (!pack.domains.includes(domain) || pack.estimatedTokens > pack.budget)
    throw new Error(`${name} context failed`);
}
const includes = (pack, id, key = "id") =>
  pack[key].some((item) => (typeof item === "string" ? item : item.id) === id);
const assert = (path, capability, lessons) => {
  const pack = parsed("--path", path);
  if (
    !includes(pack, capability, "capabilities") ||
    lessons.some((id) => !includes(pack, id, "lessons"))
  )
    throw new Error(`knowledge retrieval failed: ${path}`);
};
assert(
  "src/app/api/call-logs/confirm/route.ts",
  "canonical-call-confirmation",
  ["WRITE_READ_CLOSURE", "OFFLINE_COMPATIBILITY"],
);
assert("src/app/mappings/page.tsx", "mapping-standalone-persistence", [
  "ONE_FACT_ONE_AUTHORITY",
]);
assert(
  "src/components/visits/CurrentErpBaselineEditor.tsx",
  "current-business-erp-intelligence",
  ["ERP_AUTHORITIES", "NO_FABRICATED_BACKFILL", "TRANSACTION_STAGING"],
);
assert(
  "src/app/api/distributors/master-import/route.ts",
  "unified-distributor-master-import",
  ["ATOMIC_BATCH", "SPREADSHEET_COMMIT", "RESOLVED_PLAN_REVALIDATION"],
);
assert(
  "src/app/api/receivables/commands/route.ts",
  "receivables-command-boundary",
  ["MONEY_TRUTH", "POSTGRES_WIRE_NORMALIZATION"],
);
assert(
  "src/app/api/pipeline/create/route.ts",
  "pipeline-create-lead-boundary",
  ["SERVER_AUTHORIZATION"],
);
assert("src/app/api/chat/messages/route.ts", "team-chat-boundary", [
  "SERVER_AUTHORIZATION",
]);
assert("src/app/api/task-upload/route.ts", "task-allocation-batch-rpc", [
  "ATOMIC_BATCH",
]);
const uuidTask = parsed(
  "--path",
  "src/app/api/distributors/route.ts",
  "--task",
  "Distributor ERP filter Invalid UUID",
);
if (
  !includes(uuidTask, "POSTGRES_UUID_NOT_RFC_UUID", "lessons") ||
  !uuidTask.lessonSelection.POSTGRES_UUID_NOT_RFC_UUID?.includes("task-trigger")
)
  throw new Error("ERP UUID task-trigger retrieval failed");
const longTask = `Distributor ERP filter Invalid UUID ${"irrelevant ".repeat(1000)}`;
const longPack = parsed(
  "--path",
  "src/app/api/distributors/route.ts",
  "--task",
  longTask,
);
if (
  !includes(longPack, "POSTGRES_UUID_NOT_RFC_UUID", "lessons") ||
  longPack.estimatedTokens > longPack.budget ||
  JSON.stringify(longPack).includes(longTask)
)
  throw new Error("task context echoed or lost trigger matching");
const presentationTask = parsed(
  "--path",
  "src/app/api/distributors/route.ts",
  "--task",
  "adjust Distributor ERP footprint presentation spacing",
);
if (includes(presentationTask, "POSTGRES_UUID_NOT_RFC_UUID", "lessons"))
  throw new Error("unrelated ERP UI task retrieved UUID lesson");
const constrained = parsed(
  "--path",
  "src/app/api/distributors/route.ts",
  "--budget",
  "500",
);
if (
  !constrained.omittedLessons.length ||
  constrained.estimatedTokens > constrained.budget
)
  throw new Error("budget trimming did not preserve a usable pack");
const platform = parsed("--mode", "platform");
if (
  platform.mode !== "platform" ||
  platform.risk !== "R3" ||
  platform.estimatedTokens > platform.budget ||
  !platform.criticalPlatformRoots.includes(".github/workflows") ||
  platform.lessons
)
  throw new Error("platform discovery map failed");
try {
  run("--mode", "platform", "--budget", "1");
  throw new Error("platform ignored constrained budget");
} catch (error) {
  if (
    !String(error.stderr ?? error).includes("CONTEXT_REQUIRED_BUDGET_EXCEEDED")
  )
    throw error;
}
for (const effect of ["DATABASE", "AUTHORIZATION"])
  if (parsed("--domain", "erp", "--effect", effect).risk !== "R3")
    throw new Error(`${effect} did not escalate`);
if (parsed("--domain", "shared-ui", "--effect", "UI").risk === "R3")
  throw new Error("UI-only context escalated to R3");
const cross = parsed(
  "--path",
  "src/components/visits/CurrentErpBaselineEditor.tsx",
  "--task",
  "invalid UUID",
);
if (
  !cross.domains.includes("erp") ||
  !cross.domains.includes("field-visits") ||
  cross.scope !== "cross-domain" ||
  !includes(cross, "POSTGRES_UUID_NOT_RFC_UUID", "lessons") ||
  cross.estimatedTokens > cross.budget
)
  throw new Error("deterministic multi-domain context failed");
for (const code of ["UNMAPPED_PATH", "AUTHORITY_UNRESOLVED"]) {
  try {
    run(
      code === "UNMAPPED_PATH" ? "--path" : "--domain",
      code === "UNMAPPED_PATH" ? "src/nope.ts" : "shared-ui",
      "--effect",
      "DATABASE",
    );
    throw new Error(`${code} accepted`);
  } catch (error) {
    if (!String(error.stderr ?? error).includes(code)) throw error;
  }
}
for (const [task, domain] of [
  ["Mapping should show who logged and completed each mapping", "mappings"],
  ["calls disappear for employee but admin sees them", "calls"],
]) {
  const pack = parsed("--task", task);
  if (
    !pack.domains.includes(domain) ||
    JSON.stringify(pack).includes(task) ||
    pack.estimatedTokens > 900
  )
    throw new Error(`task-only resolution failed: ${domain}`);
}
const mappingTask = parsed(
  "--task",
  "Mapping should show who logged and who completed each mapping and all Mapping users should see team history",
);
for (const effect of ["UI", "OFFLINE", "EXPORT"])
  if (!mappingTask.relevantEffects.includes(effect))
    throw new Error(`Mapping relevance missing: ${effect}`);
for (const claim of [
  "WRITE_READ_CLOSURE",
  "OFFLINE_CONTRACT_COMPATIBILITY",
  "OFFLINE_RECOVERY_PRESERVES_INTENT",
  "STABLE_RETRY_IDENTITY",
])
  if (!mappingTask.criticalClaims.includes(claim))
    throw new Error(`Mapping claim missing: ${claim}`);
for (const proof of ["mapping-unit", "mapping-e2e"])
  if (!mappingTask.requiredProofRefs.includes(proof))
    throw new Error(`Mapping proof missing: ${proof}`);
if (
  mappingTask.lessons.length > 4 ||
  !mappingTask.mustNotWriteAuthorities.includes("pipeline_lead")
)
  throw new Error("Mapping context compaction or protected authority failed");
const handoverTask = parsed(
  "--task",
  "Move managed Supabase to self-hosted while Vercel remains the CRM app runtime",
);
if (
  !handoverTask.domains.includes("platform-handover") ||
  handoverTask.risk !== "R3" ||
  !handoverTask.effects.includes("PLATFORM") ||
  !handoverTask.requiredProofKinds.includes("handover")
)
  throw new Error("platform handover task resolution failed");
for (const [task, blocker] of [
  [
    "Restore the database dump and assume Storage objects moved with it",
    "DATABASE_DUMP_NOT_STORAGE_TRANSFER",
  ],
  [
    "Copy Auth users but ignore Auth and JWT configuration",
    "AUTH_CONFIGURATION_PARITY_REQUIRED",
  ],
  [
    "Move Postgres but do not verify Realtime",
    "REALTIME_COMPATIBILITY_REQUIRED",
  ],
  [
    "Change Vercel backend variables before target parity is proven",
    "CUTOVER_ENV_PARITY_REQUIRED",
  ],
  [
    "Rollback after target accepted writes by simply pointing Vercel back",
    "ROLLBACK_WRITE_RECONCILIATION_REQUIRED",
  ],
])
  if (parsed("--task", task).blocker !== blocker)
    throw new Error(`platform blocker missing: ${blocker}`);
console.log(`Context resolver tests passed (${cases.length} real paths).`);
