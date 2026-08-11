import { applyReceivableFilters, sanitizeReceivablesSearch } from "@/lib/receivables/filters";

describe("Receivables server filter safety", () => {
  test.each(["%", "_", ",", "(", ")", "'", "\"", "\\", "x.or(id.neq.null)", "Robert');drop table receivables;--"])("removes PostgREST grammar from %s", input => {
    expect(sanitizeReceivablesSearch(input)).not.toMatch(/[%_,().'"\\]/);
  });

  test("keeps searchable Unicode, numbers, spaces, slashes, and hyphens", () => {
    expect(sanitizeReceivablesSearch("  INV-10 / \u0935\u093f\u0924\u0930\u0915  ")).toBe("INV-10 / \u0935\u093f\u0924\u0930\u0915");
  });

  test("does not emit an or expression for punctuation-only input", () => {
    const query = { or: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis() };
    applyReceivableFilters(query, { page: 1, pageSize: 20, search: "%_(),'\\" }, true);
    expect(query.or).not.toHaveBeenCalled();
  });
});
