import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  json = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8")),
  knowledge = json("docs/engineering/LEGACY_KNOWLEDGE.json"),
  claims = json("docs/engineering/CLAIMS.json").claims,
  lessons = json("docs/engineering/LESSONS.json").lessons,
  tokenize = (value) =>
    new Set(
      String(value)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[a-z0-9_]+/g)
        ?.flatMap((x) => x.split("_"))
        ?.filter((x) => x.length > 2) ?? [],
    ),
  high =
    /production|security|authorization|\brls\b|money|financial|migration|identity|data.loss|offline|durable|owner.sql|release|exact.head/i;
const score = (text, claim) => {
    const source = tokenize(text);
    let best = 0;
    for (const phrase of claim.positiveMatchers ?? []) {
      const matcher = tokenize(phrase);
      if (!matcher.size) continue;
      let hit = 0;
      for (const token of matcher) if (source.has(token)) hit++;
      best = Math.max(
        best,
        (hit / matcher.size) * 0.8 + (hit / Math.max(source.size, 1)) * 0.2,
      );
    }
    for (const phrase of claim.negativeMatchers ?? []) {
      const negative = tokenize(phrase);
      if ([...negative].every((token) => source.has(token))) best -= 0.5;
    }
    return best;
  },
  lessonByClaim = new Map();
for (const lesson of lessons)
  for (const id of lesson.claims ?? []) {
    const list = lessonByClaim.get(id) ?? [];
    list.push(lesson.id);
    lessonByClaim.set(id, list);
  }
const reconcile = (record) => {
  const severity = high.test(record.normalizedRule) ? "CRITICAL" : "NORMAL";
  if (/normative knowledge\**/i.test(record.normalizedRule))
    return {
      legacyId: record.legacyId,
      ruleTextHash: record.ruleTextHash,
      status: "OBSOLETE",
      targets: [],
      preservedClaims: [],
      enforcementRefs: ["scripts/quality/knowledge-check.mjs"],
      evalRefs: ["task-lifecycle-hardening"],
      reason:
        "This heading contains no reusable invariant; the canonical registries now carry the actual semantics.",
      severity,
      confidence: 1,
      margin: 1,
    };
  if (
    /create `?\.harness\/task\.json`? before implementation/i.test(
      record.normalizedRule,
    )
  )
    return {
      legacyId: record.legacyId,
      ruleTextHash: record.ruleTextHash,
      status: "OBSOLETE",
      targets: [],
      preservedClaims: [],
      enforcementRefs: ["scripts/quality/knowledge-check.mjs"],
      evalRefs: ["control-plane-regressions"],
      reason:
        "ZeroGraph V3 explicitly retires the persistent .harness task controller in favor of Git-metadata session state.",
      severity,
      confidence: 1,
      margin: 1,
    };
  const threshold = severity === "CRITICAL" ? 0.55 : 0.45,
    ranked = claims
      .map((claim) => ({
        claim,
        score: score(`${record.legacyId} ${record.normalizedRule}`, claim),
      }))
      .filter((x) => x.score >= threshold)
      .sort(
        (a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id),
      ),
    top = ranked[0]?.score ?? 0,
    selected = ranked
      .filter((x) => x.score >= Math.max(threshold, top - 0.1))
      .slice(0, 6),
    ambiguous =
      selected.length > 1 &&
      selected[0].score - selected[1].score < 0.015 &&
      selected.some((x) => (x.claim.negativeMatchers ?? []).length);
  if (!selected.length || ambiguous)
    return {
      legacyId: record.legacyId,
      ruleTextHash: record.ruleTextHash,
      status: "UNRESOLVED",
      targets: [],
      preservedClaims: [],
      enforcementRefs: [],
      evalRefs: [],
      reason:
        "No independent canonical claim matcher reached the confidence and margin threshold.",
      severity,
      confidence: top,
      margin: top - (ranked[1]?.score ?? 0),
    };
  const preservedClaims = selected.map((x) => x.claim.id),
    targets = [
      ...new Set(preservedClaims.flatMap((id) => lessonByClaim.get(id) ?? [])),
    ],
    enforcementRefs = [
      ...new Set(selected.flatMap((x) => x.claim.enforcementRefs ?? [])),
    ],
    evalRefs = [...new Set(selected.flatMap((x) => x.claim.evalRefs ?? []))];
  return {
    legacyId: record.legacyId,
    ruleTextHash: record.ruleTextHash,
    status: preservedClaims.length === 1 ? "EXACT" : "CONSOLIDATED",
    targets,
    preservedClaims,
    enforcementRefs,
    evalRefs,
    reason:
      "Independent CLAIMS matcher semantics preserve this rule before lesson targets are selected.",
    severity,
    confidence: top,
    margin: top - (ranked[1]?.score ?? 0),
  };
};
const fixtureIndex = process.argv.indexOf("--text");
if (fixtureIndex >= 0) {
  const normalizedRule = process.argv[fixtureIndex + 1] ?? "";
  console.log(
    JSON.stringify(
      reconcile({
        legacyId: "FIXTURE",
        normalizedRule,
        ruleTextHash: "fixture",
      }),
    ),
  );
  process.exit(0);
}
const resolutions = knowledge.records.map(reconcile);
const output = {
  schemaVersion: 4,
  sourceSummary: knowledge.summary,
  resolutions: resolutions.sort((a, b) =>
    a.ruleTextHash.localeCompare(b.ruleTextHash),
  ),
};
if (process.argv.includes("--write")) {
  writeFileSync(
    resolve(root, "docs/engineering/LEGACY_COVERAGE.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  const lessonFile = json("docs/engineering/LESSONS.json"),
    used = new Map();
  for (const r of resolutions)
    for (const target of r.targets) {
      const list = used.get(target) ?? [];
      list.push(r.legacyId);
      used.set(target, list);
    }
  for (const lesson of lessonFile.lessons)
    lesson.legacyRefs = [...new Set(used.get(lesson.id) ?? [])].sort();
  writeFileSync(
    resolve(root, "docs/engineering/LESSONS.json"),
    `${JSON.stringify(lessonFile, null, 2)}\n`,
  );
  const byHash = new Map(resolutions.map((r) => [r.ruleTextHash, r]));
  for (const record of knowledge.records) {
    const r = byHash.get(record.ruleTextHash);
    record.claims = r.preservedClaims;
    record.domains = [
      ...new Set(
        r.preservedClaims.flatMap(
          (id) => claims.find((x) => x.id === id)?.domains ?? [],
        ),
      ),
    ];
    record.severity = r.severity;
  }
  writeFileSync(
    resolve(root, "docs/engineering/LEGACY_KNOWLEDGE.json"),
    `${JSON.stringify(knowledge, null, 2)}\n`,
  );
}
const summary = {
  total: resolutions.length,
  exact: resolutions.filter((x) => x.status === "EXACT").length,
  consolidated: resolutions.filter((x) => x.status === "CONSOLIDATED").length,
  obsolete: resolutions.filter((x) => x.status === "OBSOLETE").length,
  unresolved: resolutions.filter((x) => x.status === "UNRESOLVED").length,
  highSafetyUnresolved: resolutions.filter(
    (x) => x.status === "UNRESOLVED" && x.severity === "CRITICAL",
  ).length,
};
if (process.argv.includes("--details"))
  summary.samples = resolutions
    .filter((x) => x.status === "UNRESOLVED")
    .slice(0, 100)
    .map((x) => ({
      id: x.legacyId,
      text: knowledge.records.find((r) => r.ruleTextHash === x.ruleTextHash)
        ?.normalizedRule,
      severity: x.severity,
      confidence: x.confidence,
    }));
console.log(JSON.stringify(summary));
