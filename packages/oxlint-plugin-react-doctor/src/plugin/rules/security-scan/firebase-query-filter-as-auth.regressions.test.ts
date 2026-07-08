import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { firebaseQueryFilterAsAuth } from "./firebase-query-filter-as-auth.js";

describe("security-scan/firebase-query-filter-as-auth — regressions", () => {
  it("flags a Firestore query filtering by an auth-shaped field", () => {
    const findings = runScanRule(firebaseQueryFilterAsAuth, {
      relativePath: "src/hooks/use-docs.ts",
      content: `const q = db.collection("documents").where("uid", "==", user.uid);
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on the modular where() form (rule scopes to dotted .where calls)", () => {
    const findings = runScanRule(firebaseQueryFilterAsAuth, {
      relativePath: "src/hooks/use-owned.ts",
      content: `const q = query(collection(db, "notes"), where("ownerId", "==", uid));
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a non-auth filter field", () => {
    const findings = runScanRule(firebaseQueryFilterAsAuth, {
      relativePath: "src/hooks/use-status.ts",
      content: `const q = db.collection("documents").where("status", "==", "published");
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in server context paths", () => {
    const findings = runScanRule(firebaseQueryFilterAsAuth, {
      relativePath: "src/server/admin-query.ts",
      content: `const q = db.collection("documents").where("uid", "==", uid);
`,
    });
    expect(findings).toHaveLength(0);
  });
});
