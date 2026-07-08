import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { requestBodyMassAssignment } from "./request-body-mass-assignment.js";

describe("security-scan/request-body-mass-assignment — regressions", () => {
  it("flags spreading req.body into a database write", () => {
    const findings = runScanRule(requestBodyMassAssignment, {
      relativePath: "src/server/users.ts",
      content: `await db.user.update({ where: { id }, data: { ...req.body } });\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("stays silent when spreading internal data", () => {
    const findings = runScanRule(requestBodyMassAssignment, {
      relativePath: "src/server/users.ts",
      content: `await db.user.update({ where: { id }, data: { ...allowlistedFields } });\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
