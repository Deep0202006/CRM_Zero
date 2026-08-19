import test from "node:test";
import assert from "node:assert/strict";
import { completionFlags, validateWorktree, appliedMigrationDiffs, newlyChangedPaths, nextFromProgress, requiresOwnerProductionGate } from "../src/guards.js";

function base(overrides:any = {}) {
  return {
    acceptance:[],
    blocker:null,
    ...overrides
  };
}

test("incomplete required implementation cannot END", () => {
  const c = completionFlags(base({
    acceptance:[{
      id:"A",description:"x",stage:"IMPLEMENTATION",
      status:"PENDING",required:true,evidenceIds:[]
    }]
  }) as any);
  assert.equal(c.implementationComplete,false);
  assert.equal(c.canEnd,false);
});

test("IMPLEMENTATION_INCOMPLETE external=false is not a legal blocker", () => {
  const c = completionFlags(base({
    acceptance:[{
      id:"A",description:"x",stage:"IMPLEMENTATION",
      status:"PENDING",required:true,evidenceIds:[]
    }],
    blocker:{
      type:"IMPLEMENTATION_INCOMPLETE",
      external:false,
      reason:"not finished",
      evidenceIds:[]
    }
  }) as any);
  assert.equal(c.canEnd,false);
});

test("sibling desktop worktree is rejected", () => {
  const errors = validateWorktree(
    "C:\\Users\\dcp69\\Desktop\\CRM_Zero",
    "C:\\Users\\dcp69\\Desktop\\CRM_Zero-feature"
  );
  assert.equal(errors.length,1);
});

test("broad verification remains unavailable while implementation acceptance is pending", () => {
  const state = base({ acceptance:[{ id:"A", description:"x", stage:"IMPLEMENTATION", status:"PENDING", required:true, evidenceIds:[] }] });
  assert.equal(completionFlags(state as any).broadVerificationAllowed, false);
  assert.equal(nextFromProgress({ ...state, stallCount:0 } as any), "implement");
});

test("three no-progress iterations require human escalation", () => {
  const state = base({ acceptance:[{ id:"A", description:"x", stage:"IMPLEMENTATION", status:"PENDING", required:true, evidenceIds:[] }] });
  assert.equal(nextFromProgress({ ...state, stallCount:1 } as any), "focusedRetry");
  assert.equal(nextFromProgress({ ...state, stallCount:2 } as any), "strategyChange");
  assert.equal(nextFromProgress({ ...state, stallCount:3 } as any), "humanEscalation");
});

test("diff guard rejects changes to owner-applied migrations", () => {
  const root = new URL("../../..", import.meta.url).pathname.replace(/^\//, "");
  const hits = appliedMigrationDiffs(root, ["supabase/migrations/044_owner_history.sql", "supabase/migrations/045_new.sql"]);
  assert.deepEqual(hits, ["supabase/migrations/044_owner_history.sql"]);
});

test("progress guard considers only changes made after the preserved baseline", () => {
  assert.deepEqual(
    newlyChangedPaths(["AGENTS.md", "tools/crm-graph/"], ["AGENTS.md", "tools/crm-graph/", "tools/crm-graph/src/graph.ts"]),
    ["tools/crm-graph/src/graph.ts"]
  );
});

test("owner production gate persists until required release acceptance passes", () => {
  const state = base({ acceptance:[{ id:"R", description:"owner action", stage:"RELEASE", status:"PENDING", required:true, evidenceIds:[] }] });
  assert.equal(requiresOwnerProductionGate(state as any), true);
  state.acceptance[0].status = "PASS";
  assert.equal(requiresOwnerProductionGate(state as any), false);
});
