import { basename } from "node:path";
import { readJson } from "./kernel-lib.mjs";

export const CommandClass = Object.freeze({
  READ_ONLY_ALLOWED: "READ_ONLY_ALLOWED",
  REGISTERED_VERIFICATION_ALLOWED: "REGISTERED_VERIFICATION_ALLOWED",
  SCOPED_MUTATION_ALLOWED: "SCOPED_MUTATION_ALLOWED",
  PROHIBITED: "PROHIBITED",
  UNKNOWN_MUTATION_SHAPE: "UNKNOWN_MUTATION_SHAPE",
});

const result = (classification, reason, tokens = []) => ({ classification, reason, tokens });
const executableName = (value) => basename(String(value).replaceAll("\\", "/")).toLowerCase().replace(/\.exe$|\.cmd$/g, "");

export const tokenizeCommand = (command) => {
  const text = String(command ?? "").trim();
  if (!text) return { error: "EMPTY_COMMAND", tokens: [] };
  const tokens = [];
  let token = "", quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index], next = text[index + 1] ?? "";
    if (quote) {
      if (character === "\\" && quote === '"') token += text[++index] ?? "";
      else if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "`" || character === "\n" || character === "\r" || character === ";" || character === "|" || character === ">" || character === "<" || character === "&" || (character === "$" && next === "("))
      return { error: "UNSUPPORTED_SHELL_STRUCTURE", tokens: [] };
    if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ""; }
    } else token += character;
  }
  if (quote) return { error: "UNTERMINATED_QUOTE", tokens: [] };
  if (token) tokens.push(token);
  return { tokens };
};

const unwrapPackageExecutor = (tokens) => {
  const executable = executableName(tokens[0]);
  if (executable === "npx") return tokens.slice(1);
  if (executable === "npm" && tokens[1] === "exec") {
    const separator = tokens.indexOf("--");
    return separator >= 0 ? tokens.slice(separator + 1) : tokens.slice(2);
  }
  return tokens;
};

const proofNodeScripts = () => {
  const scripts = new Set();
  for (const proof of readJson("docs/engineering/PROOFS.json").proofs) {
    if (proof.runner === "node") for (const path of proof.paths ?? []) scripts.add(path);
    for (const command of proof.commands ?? []) if (executableName(command.file) === "node" && command.args?.[0]) scripts.add(command.args[0]);
  }
  return scripts;
};

const readOnlyGit = new Set(["status", "diff", "show", "log", "rev-parse", "merge-base", "ls-files", "branch", "remote", "worktree"]);
const prohibitedGit = new Set(["reset", "clean", "apply", "checkout", "restore", "merge", "rebase", "cherry-pick"]);
const safeNpmScripts = new Set([
  "quality:repository", "quality:knowledge", "quality:invariants", "kernel:doctor", "kernel:test", "kernel:status",
  "context:resolve", "context:explain", "context:test", "registry:index", "impact:compile", "proof:plan", "proof:run",
  "proof:certify-ci", "regression:test", "typecheck", "lint", "build", "test", "handover:check", "graphify:verify",
]);
const databaseClients = new Set(["psql", "pgcli", "mysql", "sqlcmd"]);
const infrastructure = new Set(["vercel", "terraform", "docker", "kubectl", "aws", "az", "gcloud", "cloudflare", "supabase"]);
const mutatingInfrastructureWords = new Set(["apply", "alias", "create", "db", "delete", "deploy", "destroy", "down", "env", "link", "migration", "promote", "push", "reset", "rm", "rollback", "set", "unlink", "up"]);
const writePrimitives = new Set(["tee", "rm", "mv", "cp", "del", "rmdir", "sed", "perl", "set-content", "add-content", "remove-item", "move-item", "copy-item", "out-file"]);

export const classifyCommand = (command) => {
  const parsed = tokenizeCommand(command);
  if (parsed.error) return result(CommandClass.PROHIBITED, parsed.error);
  const original = parsed.tokens, tokens = unwrapPackageExecutor(original);
  if (!tokens.length) return result(CommandClass.PROHIBITED, "EMPTY_WRAPPED_COMMAND", original);
  const executable = executableName(tokens[0]), args = tokens.slice(1), lower = args.map((value) => value.toLowerCase());

  if (["sh", "bash", "cmd", "powershell", "pwsh"].includes(executable) && lower.some((value) => ["-c", "/c", "-command", "-encodedcommand", "-enc"].includes(value)))
    return result(CommandClass.PROHIBITED, "NESTED_SHELL_WRAPPER", original);
  if (writePrimitives.has(executable) || (executable === "printf" && original.some((value) => /[<>]/.test(value))))
    return result(CommandClass.PROHIBITED, "UNSCOPED_WRITE_PRIMITIVE", original);
  if (databaseClients.has(executable)) return result(CommandClass.PROHIBITED, "DATABASE_CLIENT", original);

  if (executable === "git") {
    const verb = lower[0] ?? "";
    if (prohibitedGit.has(verb)) return result(CommandClass.PROHIBITED, `GIT_${verb.toUpperCase().replaceAll("-", "_")}`, original);
    if (verb === "add") {
      if (!args.slice(1).length || args.slice(1).some((value) => ["-a", "--all", ".", "-u", "--update"].includes(value.toLowerCase()))) return result(CommandClass.PROHIBITED, "GIT_BROAD_ADD", original);
      return result(CommandClass.SCOPED_MUTATION_ALLOWED, "GIT_EXPLICIT_ADD", original);
    }
    if (verb === "commit") return result(CommandClass.SCOPED_MUTATION_ALLOWED, "GIT_COMMIT", original);
    if (verb === "push") {
      if (lower.some((value) => value === "-f" || value.startsWith("--force"))) return result(CommandClass.PROHIBITED, "GIT_FORCE_PUSH", original);
      if (lower.some((value) => value === "main" || /(?:^|:)refs\/heads\/main$/.test(value) || /(?:^|:)main$/.test(value) || value === ":main")) return result(CommandClass.PROHIBITED, "GIT_MAIN_PUSH", original);
      const pushArgs = args.slice(1);
      if (pushArgs[0] === "origin" && pushArgs.length === 2 && /^(?:chore|feat|fix|docs|test|refactor)\/[a-z0-9._/-]+$/i.test(pushArgs[1])) return result(CommandClass.SCOPED_MUTATION_ALLOWED, "GIT_FEATURE_PUSH", original);
      return result(CommandClass.PROHIBITED, "GIT_PUSH_UNRESOLVED", original);
    }
    if (readOnlyGit.has(verb) || verb === "fetch") return result(CommandClass.READ_ONLY_ALLOWED, "GIT_READ_ONLY", original);
    return result(CommandClass.UNKNOWN_MUTATION_SHAPE, "GIT_UNKNOWN", original);
  }

  if (executable === "gh") {
    if (lower[0] === "pr" && lower[1] === "merge") return result(CommandClass.PROHIBITED, "GITHUB_MERGE", original);
    if (lower[0] === "pr" && ["view", "checks"].includes(lower[1])) return result(CommandClass.READ_ONLY_ALLOWED, "GITHUB_PR_READ", original);
    if (lower[0] === "repo" && lower[1] === "view") return result(CommandClass.READ_ONLY_ALLOWED, "GITHUB_REPO_READ", original);
    if (lower[0] === "pr" && lower[1] === "create") return result(CommandClass.SCOPED_MUTATION_ALLOWED, "GITHUB_PR_CREATE", original);
    return result(CommandClass.UNKNOWN_MUTATION_SHAPE, "GITHUB_UNKNOWN", original);
  }

  if (infrastructure.has(executable)) {
    if (args.length === 1 && ["--version", "version"].includes(lower[0])) return result(CommandClass.READ_ONLY_ALLOWED, "VERSION_QUERY", original);
    if (lower.some((value) => mutatingInfrastructureWords.has(value) || value === "--prod" || value === "-f")) return result(CommandClass.PROHIBITED, "INFRASTRUCTURE_MUTATION", original);
    return result(CommandClass.PROHIBITED, "INFRASTRUCTURE_COMMAND_UNPROVEN", original);
  }

  if (["node", "python", "python3"].includes(executable)) {
    if (lower.some((value) => value === "-e" || value === "--eval" || value === "-c" || value === "--input-type")) return result(CommandClass.PROHIBITED, "INTERPRETER_INLINE_CODE", original);
    if (executable !== "node" || !args[0] || !proofNodeScripts().has(args[0].replaceAll("\\", "/"))) return result(CommandClass.PROHIBITED, "INTERPRETER_SCRIPT_UNREGISTERED", original);
    return result(CommandClass.REGISTERED_VERIFICATION_ALLOWED, "REGISTERED_NODE_SCRIPT", original);
  }

  if (executable === "npm") {
    if (lower[0] === "ci") return result(CommandClass.REGISTERED_VERIFICATION_ALLOWED, "NPM_CI", original);
    if (lower[0] === "test") return result(CommandClass.REGISTERED_VERIFICATION_ALLOWED, "NPM_TEST", original);
    if (lower[0] === "run" && safeNpmScripts.has(args[1])) return result(CommandClass.REGISTERED_VERIFICATION_ALLOWED, "NPM_REGISTERED_SCRIPT", original);
    return result(CommandClass.UNKNOWN_MUTATION_SHAPE, "NPM_COMMAND_UNREGISTERED", original);
  }

  if (["rg", "get-content", "get-item", "get-childitem", "test-path", "resolve-path", "select-string", "where.exe"].includes(executable))
    return result(CommandClass.READ_ONLY_ALLOWED, "READ_ONLY_UTILITY", original);
  return result(CommandClass.UNKNOWN_MUTATION_SHAPE, "COMMAND_UNPROVEN", original);
};
