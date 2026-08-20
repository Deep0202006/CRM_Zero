jest.mock("server-only", () => ({}), { virtual: true });

import fs from "fs";
import path from "path";
import { POST } from "@/app/api/distributors/master-import/route";

describe("master preview API contract", () => {
  test("exports a compiled POST Route Handler", () => {
    expect(typeof POST).toBe("function");
  });

  test("is Admin-only, parses workbook bytes server-side, and revalidates before one atomic confirmation RPC", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/distributors/master-import/route.ts"), "utf8");
    expect(route).toContain("if (!context.isAdmin)");
    expect(route).toContain("readMasterWorkbook(new Uint8Array(await file.arrayBuffer()), file.name)");
    expect(route).toContain('z.enum(["preview", "confirm"])');
    expect(route).toContain("buildMasterImportPreview");
    expect(route).toContain("revalidateMasterImportConfirmation");
    expect(route).toContain("IMPORT_REFRESH_REQUIRED");
    expect(route.indexOf("revalidateMasterImportConfirmation")).toBeLessThan(route.indexOf("confirmMasterImport(context.service"));
    expect(route.indexOf("readMasterWorkbook(new Uint8Array(await file.arrayBuffer()), file.name)")).toBeLessThan(route.indexOf("revalidateMasterImportConfirmation(context.service"));
    expect(route).not.toMatch(/form\.get\(["'](?:rows|execution|preview)["']\)/);
    expect(route).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)/);
  });
});
