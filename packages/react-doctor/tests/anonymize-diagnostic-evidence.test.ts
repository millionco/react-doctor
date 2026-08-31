import { describe, expect, it } from "vite-plus/test";
import { anonymizeDiagnosticEvidence } from "../src/cli/utils/anonymize-diagnostic-evidence.js";
import { RULE_EVIDENCE_MAX_TOKEN_COUNT } from "../src/cli/utils/constants.js";

describe("anonymizeDiagnosticEvidence", () => {
  it("preserves syntax and binding relationships without source names or literal contents", () => {
    const evidence = `
      // Customer-specific behavior
      const customerEmail = "person@example.com";
      useEffect(() => setCustomer(customerEmail), [customerEmail]);
    `;

    const result = anonymizeDiagnosticEvidence(evidence);

    expect(result.pattern).toContain("const identifier_1 = string_literal ;");
    expect(result.pattern).toContain("identifier_2 ( ( ) => identifier_3 ( identifier_1 )");
    expect(result.pattern).not.toContain("Customer-specific");
    expect(result.pattern).not.toContain("customerEmail");
    expect(result.pattern).not.toContain("person@example.com");
    expect(result.truncated).toBe(false);
  });

  it("uses stable placeholders for repeated identifiers", () => {
    const result = anonymizeDiagnosticEvidence("value + value + other");

    expect(result.pattern).toBe("identifier_1 + identifier_1 + identifier_2");
  });

  it("removes primitive literal values", () => {
    const result = anonymizeDiagnosticEvidence("[0, 1, 42, true, false, null]");

    expect(result.pattern).toBe(
      "[ number_literal , number_literal , number_literal , boolean_literal , boolean_literal , null_literal ]",
    );
  });

  it("bounds the exported pattern while retaining the original token count", () => {
    const evidence = Array.from(
      { length: RULE_EVIDENCE_MAX_TOKEN_COUNT + 10 },
      (_unused, index) => `identifier${index};`,
    ).join(" ");

    const result = anonymizeDiagnosticEvidence(evidence);

    expect(result.tokenCount).toBeGreaterThan(RULE_EVIDENCE_MAX_TOKEN_COUNT);
    expect(result.pattern.split(" ")).toHaveLength(RULE_EVIDENCE_MAX_TOKEN_COUNT);
    expect(result.truncated).toBe(true);
  });
});
