import { buildSourceIndex } from "./source-index.mjs";
import { executeRegressionCases, validateCaseResult } from "./regression-executors.mjs";
import { readJson } from "./kernel-lib.mjs";

const cases = readJson("docs/engineering/REGRESSION_CASES.json").cases, claims = readJson("docs/engineering/CLAIMS.json").claims;
const { results, coverageFailures } = executeRegressionCases({ cases, claims, index: buildSourceIndex({ writeCache: false }) });
const failures = [...results.flatMap((result) => { try { validateCaseResult(result); return []; } catch (error) { return [error.message]; } }), ...coverageFailures];
console.log(JSON.stringify({ cases: cases.length, claims: claims.length, executed: results.filter((result) => result.executed).length, results, failures }, null, 2));
if (failures.length) process.exit(1);
