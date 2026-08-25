import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadState, saveState } from "./hooks/state.mjs";
const root = resolve(import.meta.dirname, "../.."),
  args = process.argv.slice(2),
  value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  },
  failure = value("--failure") ?? "",
  suppliedSignature = value("--signature"),
  session = value("--session") ?? "learn-close",
  hash = (v) => createHash("sha256").update(v).digest("hex"),
  tokens = (v) =>
    new Set(
      v
        .normalize("NFKC")
        .toLowerCase()
        .match(/[a-z0-9_]+/g) ?? [],
    ),
  lessons = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/LESSONS.json")),
  ).lessons,
  input = tokens(failure);
let matched = null,
  best = 0;
for (const lesson of lessons) {
  const candidate = tokens(
    [
      lesson.id,
      lesson.rule,
      lesson.why,
      ...(lesson.triggers ?? []),
      ...(lesson.claims ?? []),
    ].join(" "),
  );
  let score = 0;
  for (const token of input)
    if (token.length > 3 && candidate.has(token)) score++;
  if (score > best) {
    best = score;
    matched = lesson;
  }
}
const reusable =
    /authority|security|authorization|data.integrity|production|verification|offline|resource|test.realism|release.evidence|workflow/i.test(
      failure,
    ),
  classification =
    best > 0
      ? "KNOWN_RULE_ENFORCEMENT_GAP"
      : reusable
        ? "NOVEL_LESSON_REQUIRED"
        : "NON_REUSABLE_FAILURE",
  gitPath = execFileSync(
    "git",
    ["rev-parse", "--git-path", `zerograph/sessions/${session}.learning.json`],
    { cwd: root, encoding: "utf8" },
  ).trim(),
  record = {
    failureSignature: suppliedSignature ?? hash(failure),
    classification,
    lessonId: matched?.id ?? null,
    caughtBeforeEscape: process.argv.includes("--caught"),
  };
mkdirSync(dirname(resolve(root, gitPath)), { recursive: true });
writeFileSync(resolve(root, gitPath), `${JSON.stringify(record, null, 2)}\n`);
if (session !== "learn-close") {
  const state = loadState(session);
  saveState({
    ...state,
    session_id: session,
    learning: [...(state.learning ?? []), record],
  });
}
console.log(JSON.stringify(record));
