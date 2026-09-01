import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const repositoryRoot = () => execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
}).trim();

export const engineeringTempRoot = (scope = "") => {
  if (scope && !/^[a-z0-9][a-z0-9-]*$/i.test(scope)) throw new Error("CRM_MANAGED_SCOPE_INVALID");
  return resolve(repositoryRoot(), ".tmp", "engineering", scope);
};

export const assertManagedPath = (path) => {
  const base = engineeringTempRoot(), target = resolve(path), child = relative(base, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("CRM_MANAGED_PATH_OUTSIDE_ROOT");
  return target;
};

export const makeEngineeringTemp = (prefix) => {
  const base = engineeringTempRoot();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(resolve(base, `${String(prefix).replace(/[^a-z0-9-]/gi, "-")}-`));
};

export const removeEngineeringTemp = (path) => rmSync(assertManagedPath(path), { recursive: true, force: true });
