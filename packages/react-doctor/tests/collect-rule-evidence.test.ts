import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Diagnostic } from "@react-doctor/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectRuleEvidence } from "../src/cli/utils/collect-rule-evidence.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/example.tsx",
  plugin: "react-doctor",
  rule: "no-direct-set-state-in-use-effect",
  severity: "warning",
  message: "State update in an effect",
  help: "Derive the value while rendering",
  line: 2,
  column: 1,
  category: "State & Effects",
  ...overrides,
});

describe("collectRuleEvidence", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rule-evidence-"));
    fs.mkdirSync(path.join(directory, "src"));
    fs.writeFileSync(
      path.join(directory, "src/example.tsx"),
      [
        "const customerName = 'private customer';",
        "useEffect(() => setName(customerName), [customerName]);",
        "const accountSecret = 'low-entropy-secret';",
        "useEffect(() => setAccount({ value: accountSecret }), [accountSecret]);",
      ].join("\n"),
    );
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("collects bounded source patterns without file paths, identifiers, or literals", () => {
    const [record] = collectRuleEvidence(directory, [buildDiagnostic()]);

    expect(record?.rule).toBe("react-doctor/no-direct-set-state-in-use-effect");
    expect(record?.pattern).toContain("identifier_1");
    expect(record?.pattern).not.toContain("example.tsx");
    expect(record?.pattern).not.toContain("customerName");
    expect(record?.pattern).not.toContain("private customer");
  });

  it("deduplicates identical evidence for the same rule", () => {
    const records = collectRuleEvidence(directory, [buildDiagnostic(), buildDiagnostic()]);

    expect(records).toHaveLength(1);
  });

  it("keeps distinct evidence without exposing its source text", () => {
    const records = collectRuleEvidence(directory, [
      buildDiagnostic(),
      buildDiagnostic({ line: 4 }),
    ]);

    expect(records).toHaveLength(2);
    expect(records[1]?.pattern).not.toContain("accountSecret");
    expect(records[1]?.pattern).not.toContain("low-entropy-secret");
  });

  it("ignores diagnostics from third-party plugins", () => {
    const records = collectRuleEvidence(directory, [
      buildDiagnostic({ plugin: "private-company-plugin" }),
    ]);

    expect(records).toEqual([]);
  });
});
