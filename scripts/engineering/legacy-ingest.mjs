import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  FROZEN_LEGACY_BASE = "932bc6d613992071518175e2a86d9e254169a800",
  hash = (value) => createHash("sha256").update(value).digest("hex"),
  sourceHash = (value) =>
    hash(
      (Buffer.isBuffer(value) ? value.toString("utf8") : String(value)).replace(
        /\r\n/g,
        "\n",
      ),
    ),
  git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 96 * 1024 * 1024,
    }).trim(),
  norm = (value) =>
    String(value)
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .replace(/^[-*#\d.)\s]+/, "")
      .trim();
// LEGACY_KNOWLEDGE / LEGACY_COVERAGE are certified historical inputs; new work
// belongs in the current engineering registries, not this historical corpus.
const refresh = process.argv.includes("--refresh"),
  check = process.argv.includes("--check"),
  write = process.argv.includes("--write"),
  frozenFiles = [
    "docs/engineering/LEGACY_KNOWLEDGE.json",
    "docs/engineering/LEGACY_COVERAGE.json",
  ],
  fail = (code) => {
    console.error(JSON.stringify({ code }));
    process.exit(2);
  };
if (write && !refresh) fail("LEGACY_REFRESH_REQUIRES_EXPLICIT_MODE");
if (!refresh) {
  if (
    spawnSync("git", ["merge-base", "--is-ancestor", FROZEN_LEGACY_BASE, "HEAD"], {
      cwd: root,
    }).status !== 0
  )
    fail("LEGACY_FROZEN_BASE_NOT_ANCESTOR");
  const frozen = frozenFiles.map((path) =>
      execFileSync("git", ["show", `${FROZEN_LEGACY_BASE}:${path}`], {
        cwd: root,
      }),
    ),
    current = frozenFiles.map((path) => readFileSync(resolve(root, path))),
    frozenJson = frozen.map((content) => JSON.parse(content)),
    currentJson = current.map((content) => JSON.parse(content));
  if (
    frozenJson.some(
      (value, index) =>
        !Number.isInteger(value.schemaVersion) ||
        currentJson[index].schemaVersion !== value.schemaVersion,
    )
  )
    fail("LEGACY_FROZEN_BASELINE_DRIFT");
  const frozenHashes = frozen.map(sourceHash), currentHashes = current.map(sourceHash);
  if (frozenHashes.some((value, index) => value !== currentHashes[index]))
    fail("LEGACY_FROZEN_BASELINE_DRIFT");
  console.log(
    JSON.stringify({
      code: "LEGACY_FROZEN_BASELINE_PASS",
      frozenBaseSha: FROZEN_LEGACY_BASE,
      knowledgeSha256: currentHashes[0],
      coverageSha256: currentHashes[1],
    }),
  );
  process.exit(0);
}
const relevant =
    /(^|\/)(AGENTS\.md|[^/]*(instructions?|rules?)\.md|docs\/(os|quality|architecture|contracts|engineering[^/]*|exec-plans|data-platform-repair)\/|\.harness\/|\.crm-engineering\/(manifest|policy|knowledge|tasks|proofs|schemas)\/|tools\/crm-graph\/|scripts\/[^/]*(engineering|harness)|\.archive\/.*(engineering|harness|incident)|skills\/.*(zero|crm))/i,
  excluded =
    /(^|\/)(\.git|\.worktrees|node_modules|\.next|dist|coverage|playwright-report|test-results|vendor)(\/|$)|(^|\/)\.env|secret|credential|\.(png|jpe?g|gif|webp|zip|gz|pdf|exe|dll)$/i,
  normative =
    /\b(must|never|required?|do not|cannot|may not|only when|one fact|owner|fail(?:s|ed)? closed|exact head|immutable|authorization|rls|rollback|retry|acceptance|evidence)\b/i;
const generatedOutput =
  /docs\/engineering\/(?:LEGACY_KNOWLEDGE|LEGACY_COVERAGE)\.json$/i;
const extract = (path, content) => {
  const rows = [],
    add = (text, legacyId, knownRegistry = false) => {
      const rule = norm(text),
        modal =
          /\b(must|never|required?|do not|cannot|may not|only when|one fact|fail(?:s|ed)? closed|immutable|exact head)\b/i;
      if (
        /^\[[ x]\]/i.test(rule) ||
        /surviving POOJA record|do not revert PR #/i.test(rule) ||
        rule.length < 12 ||
        rule.length > 1200 ||
        (!knownRegistry && !normative.test(rule)) ||
        (!legacyId && !modal.test(rule))
      )
        return;
      rows.push({ normalizedRule: rule, legacyId });
    };
  if (/LESSONS_LEDGER\.md$/i.test(path))
    for (const line of content
      .split(/\r?\n/)
      .filter((x) => /^\|\s*20\d\d-/.test(x))) {
      const cells = line.split("|").map(norm);
      add(cells[5]);
    }
  if (/\.json$/i.test(path))
    try {
      const data = JSON.parse(content),
        proofSource = /\.crm-engineering\/proofs\//i.test(path),
        walk = (value, key = "") => {
          if (Array.isArray(value))
            return value.forEach((item) => walk(item, key));
          if (value && typeof value === "object") {
            const id = value.id ?? value.legacyId ?? value.ruleId;
            for (const [k, v] of Object.entries(value))
              if (
                typeof v === "string" &&
                (/(rule|lesson|invariant|accept|criterion|require)/i.test(k) ||
                  (proofSource &&
                    /(failure|retry|proof|title|name|reason)/i.test(k)))
              )
                add(v, id, proofSource);
              else walk(v, k);
            return;
          }
          if (
            typeof value === "string" &&
            /(accept|invariant|require|rule|proof)/i.test(key)
          )
            add(value);
        };
      walk(data);
    } catch {}
  if (/\.md$/i.test(path))
    for (const line of content.split(/\r?\n/))
      if (/^\s*(?:[-*]|\d+[.)]|#{1,6})\s+/.test(line) && normative.test(line))
        add(line);
  if (
    /(test|spec|verify|guard|controller|harness).*(?:\.[cm]?[jt]s|\.py|\.sh)$/i.test(
      path,
    )
  )
    for (const match of content.matchAll(
      /(?:test|it|describe)\s*\(\s*["'`]([^"'`]{12,300})/g,
    ))
      add(match[1], `TEST_${hash(match[1]).slice(0, 12)}`);
  return [...new Map(rows.map((x) => [hash(x.normalizedRule), x])).values()];
};
// Enumerate every local ref as required, then bind tracked certification to
// portable repository refs so an Owner-only local branch cannot make CI stale.
const canonicalObjects = new Set(
    git("rev-list", "--objects", "HEAD", "--remotes=origin")
      .split(/\r?\n/)
      .map((line) => line.split(" ", 1)[0]),
  ),
  discovered = git("rev-list", "--objects", "--all")
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(" ");
      return i < 0
        ? null
        : {
            objectHash: line.slice(0, i),
            path: line.slice(i + 1).replaceAll("\\", "/"),
          };
    })
    .filter(Boolean)
    .filter((item) => canonicalObjects.has(item.objectHash))
    .filter(
      (x) =>
        !generatedOutput.test(x.path) &&
        (relevant.test(x.path) || /skills\//i.test(x.path)),
    ),
  types = spawnSync(
    "git",
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    {
      cwd: root,
      encoding: "utf8",
      input: discovered.map((x) => x.objectHash).join("\n"),
    },
  )
    .stdout.split(/\r?\n/)
    .reduce((m, line) => {
      const [id, type] = line.split(" ");
      if (id) m.set(id, type);
      return m;
    }, new Map()),
  items = discovered.filter((x) => types.get(x.objectHash) === "blob"),
  seen = new Map(),
  sources = [],
  records = [];
let filesystemGovernanceSources = 0;
const ingest = (item, content) => {
  if (excluded.test(item.path)) {
    sources.push({
      ...item,
      classification: "SENSITIVE_SKIPPED",
      extractedRecordCount: 0,
    });
    return;
  }
  if (seen.has(item.blobHash)) {
    sources.push({
      ...item,
      classification: "DUPLICATE",
      duplicateOf: seen.get(item.blobHash),
      extractedRecordCount: 0,
    });
    return;
  }
  seen.set(item.blobHash, item.path);
  if (!relevant.test(item.path)) {
    sources.push({
      ...item,
      classification: /skills\//i.test(item.path)
        ? "GENERIC_TOOLING"
        : "NON_KNOWLEDGE",
      extractedRecordCount: 0,
    });
    return;
  }
  const extracted = extract(item.path, content);
  sources.push({
    ...item,
    classification: extracted.length ? "KNOWLEDGE_USED" : "SUPPORTING_EVIDENCE",
    extractedRecordCount: extracted.length,
  });
  for (const row of extracted)
    records.push({
      ...row,
      sourceRef: item.path,
      sourceBlobHash: item.blobHash,
    });
};
for (const item of items) {
  let content = "";
  try {
    content = execFileSync("git", ["cat-file", "blob", item.objectHash], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    sources.push({
      ...item,
      classification: "SENSITIVE_SKIPPED",
      extractedRecordCount: 0,
    });
    continue;
  }
  ingest({ blobHash: sourceHash(content), path: item.path }, content);
}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name),
      rel = relative(root, full).replaceAll("\\", "/");
    if (excluded.test(rel) || generatedOutput.test(rel)) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full);
    else if (relevant.test(rel) && stat.size < 4 * 1024 * 1024) {
      filesystemGovernanceSources++;
      const content = readFileSync(full),
        blobHash = sourceHash(content);
      if (!seen.has(blobHash))
        ingest({ blobHash, path: rel }, content.toString("utf8"));
    }
  }
};
walk(root);
if (
  process.env.ZEROGRAPH_LEGACY_CORPUS &&
  existsSync(process.env.ZEROGRAPH_LEGACY_CORPUS)
) {
  const external = resolve(process.env.ZEROGRAPH_LEGACY_CORPUS),
    scan = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name),
          rel = relative(external, full).replaceAll("\\", "/");
        if (excluded.test(rel) || generatedOutput.test(rel)) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) scan(full);
        else if (stat.size < 4 * 1024 * 1024)
          ingest(
            {
              blobHash: sourceHash(readFileSync(full)),
              path: `external:${rel}`,
            },
            readFileSync(full, "utf8"),
          );
      }
    };
  scan(external);
}
// Curated legacy registries are semantic sources even when a rule omits a modal verb.
for (const item of items.filter((entry) =>
  /(lessons-registry|policy\/rules)\.json$/i.test(entry.path),
)) {
  try {
    const content = execFileSync("git", ["cat-file", "blob", item.objectHash], {
        cwd: root,
        encoding: "utf8",
      }),
      data = JSON.parse(content),
      contentHash = sourceHash(content),
      walk = (value) => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (!value || typeof value !== "object") return;
        if (typeof value.id === "string" && typeof value.rule === "string") {
          const normalizedRule = norm(value.rule);
          if (normalizedRule.length >= 12)
            records.push({
              normalizedRule,
              legacyId: value.id,
              sourceRef: item.path,
              sourceBlobHash: contentHash,
            });
        }
        Object.values(value).forEach(walk);
      };
    walk(data);
  } catch {}
}
const byRule = new Map();
for (const record of records) {
  const ruleTextHash = hash(record.normalizedRule),
    candidate = {
      ...record,
      legacyId: record.legacyId ?? `LEGACY_${ruleTextHash.slice(0, 16)}`,
      ruleTextHash,
      claims: [],
      domains: [],
      severity: null,
    },
    current = byRule.get(ruleTextHash);
  if (
    !current ||
    (/_RULE$/.test(candidate.legacyId) && !/_RULE$/.test(current.legacyId))
  )
    byRule.set(ruleTextHash, candidate);
}
const unique = [...byRule.values()],
  ledgerBlobs = new Set(
    sources
      .filter(
        (x) =>
          /LESSONS_LEDGER\.md$/i.test(x.path) &&
          x.classification === "KNOWLEDGE_USED",
      )
      .map((x) => x.blobHash),
  ),
  summary = {
    sourceBlobCount: new Set(sources.map((x) => x.blobHash).filter(Boolean))
      .size,
    filesystemGovernanceSources,
    ledgerVersionCount: ledgerBlobs.size,
    rawLessonRowCount: records.filter((x) =>
      /LESSONS_LEDGER\.md$/i.test(x.sourceRef),
    ).length,
    uniqueNormalizedRules: unique.length,
    knowledgeUsedWithoutSemantics: sources.filter(
      (x) => x.classification === "KNOWLEDGE_USED" && !x.extractedRecordCount,
    ).length,
    parserFamilies: [
      "ledger",
      "golden-principles",
      "protocol",
      "agents",
      "policy-rules",
      "lesson-registry",
      "task-acceptance",
      "proof-record",
      "harness-test",
      "exec-plan",
    ],
  };
if (
  summary.ledgerVersionCount < 20 ||
  unique.length < 29 ||
  summary.knowledgeUsedWithoutSemantics
) {
  console.error(
    JSON.stringify({ code: "LEGACY_SOURCE_INCOMPLETE", ...summary }),
  );
  process.exit(2);
}
const output = {
  schemaVersion: 2,
  generatedFrom: "git rev-list --objects --all + targeted filesystem scan",
  summary,
  sourceHashes: [
    ...new Set(sources.map((x) => x.blobHash).filter(Boolean)),
  ].sort(),
  sources: sources.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.blobHash.localeCompare(b.blobHash),
  ),
  records: unique.sort((a, b) => a.ruleTextHash.localeCompare(b.ruleTextHash)),
};
if (check) {
  const tracked = JSON.parse(
      readFileSync(
        resolve(root, "docs/engineering/LEGACY_KNOWLEDGE.json"),
        "utf8",
      ),
    ),
    project = (value) => ({
      schemaVersion: value.schemaVersion,
      generatedFrom: value.generatedFrom,
      summary: value.summary,
      sourceHashes: value.sourceHashes,
      sources: value.sources,
      records: value.records.map(
        ({
          legacyId,
          sourceRef,
          sourceBlobHash,
          ruleTextHash,
          normalizedRule,
        }) => ({
          legacyId,
          sourceRef,
          sourceBlobHash,
          ruleTextHash,
          normalizedRule,
        }),
      ),
    });
  if (JSON.stringify(project(output)) !== JSON.stringify(project(tracked))) {
    const currentHashes = new Set(output.sourceHashes),
      trackedHashes = new Set(tracked.sourceHashes);
    console.error(
      JSON.stringify({
        code: "LEGACY_SOURCE_STALE",
        currentSummary: output.summary,
        trackedSummary: tracked.summary,
        addedSourceHashes: [...currentHashes].filter(
          (value) => !trackedHashes.has(value),
        ),
        removedSourceHashes: [...trackedHashes].filter(
          (value) => !currentHashes.has(value),
        ),
        currentRecords: output.records.length,
        trackedRecords: tracked.records.length,
      }),
    );
    process.exit(2);
  }
}
if (write)
  writeFileSync(
    resolve(root, "docs/engineering/LEGACY_KNOWLEDGE.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
console.log(JSON.stringify(summary));
