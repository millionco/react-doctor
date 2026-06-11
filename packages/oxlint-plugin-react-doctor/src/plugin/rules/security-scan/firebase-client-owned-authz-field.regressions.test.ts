import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { firebaseClientOwnedAuthzField } from "./firebase-client-owned-authz-field.js";

describe("security-scan/firebase-client-owned-authz-field — regressions", () => {
  it("flags client firestore writes carrying ownership fields", () => {
    const findings = runScanRule(firebaseClientOwnedAuthzField, {
      relativePath: "src/features/projects/create-project.ts",
      content: `import { addDoc, collection } from "firebase/firestore";\nexport const createProject = (name: string, userId: string) =>\n  addDoc(collection(db, "projects"), { name, ownerId: userId, role: "admin" });\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on in-house writers that merely share firestore method names (affine updateDoc shape)", () => {
    const findings = runScanRule(firebaseClientOwnedAuthzField, {
      relativePath: "src/plugins/copilot/mcp/provider.ts",
      content: `export class DocProvider {\n  async apply(workspaceId: string, docId: string, content: string, userId: string) {\n    await this.writer.updateDoc(workspaceId, docId, content, userId);\n  }\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
