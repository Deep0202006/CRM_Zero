import { deriveAlertState, derivePaymentState, formatInr, parseMoneyToMinorUnits } from "@/lib/receivables/domain";

describe("receivables exact money and alert contract", () => {
  test.each([
    ["1000", BigInt(100000)],
    ["84,500", BigInt(8450000)],
    ["\u20b984,500.00", BigInt(8450000)],
    ["0.01", BigInt(1)],
    ["  84,500.10  ", BigInt(8450010)],
    ["999999999999.99", BigInt("99999999999999")],
  ])("parses %s exactly", (value, expected) => expect(parseMoneyToMinorUnits(value)).toBe(expected));

  test.each(["0", "-1", "1.001", "nope", "NaN", "Infinity", "1e3", "1000000000000.00", "999999999999.991", "999999999999999999999999"])("rejects %s", value => expect(() => parseMoneyToMinorUnits(value)).toThrow());

  test("derives confirmed-only states", () => {
    expect(derivePaymentState("active", BigInt(100000), BigInt(0))).toBe("Unpaid");
    expect(derivePaymentState("active", BigInt(100000), BigInt(40000))).toBe("Partially Paid");
    expect(derivePaymentState("active", BigInt(100000), BigInt(100000))).toBe("Paid");
    expect(() => derivePaymentState("active", BigInt(100000), BigInt(100001))).toThrow();
    expect(derivePaymentState("disputed", BigInt(100000), BigInt(0))).toBe("Disputed");
    expect(derivePaymentState("cancelled", BigInt(100000), BigInt(0))).toBe("Cancelled");
  });

  test("formats Indian currency", () => expect(formatInr("142500.00")).toContain("1,42,500"));

  test("pending verification suppresses chase and terminal states suppress alerts", () => {
    const base = { lifecycleStatus: "active" as const, outstandingMinor: BigInt(100000), today: "2026-08-11", nextFollowUpDate: "2026-08-10", promiseDate: null };
    expect(deriveAlertState({ ...base, paymentVerificationPending: true })).toBe("payment_verification_pending");
    expect(deriveAlertState({ ...base, paymentVerificationPending: false })).toBe("followup_overdue");
    expect(deriveAlertState({ ...base, outstandingMinor: BigInt(0), paymentVerificationPending: false })).toBe("none");
    expect(deriveAlertState({ ...base, lifecycleStatus: "cancelled", paymentVerificationPending: false })).toBe("none");
    expect(deriveAlertState({ ...base, lifecycleStatus: "disputed", paymentVerificationPending: false })).toBe("disputed");
  });
});
