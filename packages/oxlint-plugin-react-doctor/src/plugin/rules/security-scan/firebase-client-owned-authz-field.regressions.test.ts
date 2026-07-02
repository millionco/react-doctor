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

  // FP wave 4: a benign write (`{ displayName }`) followed by an UNRELATED
  // later statement that merely reads `.role` must not fire — the authz
  // field must live inside the write call's own statement.
  it("stays silent when .role belongs to a separate later statement", () => {
    const findings = runScanRule(firebaseClientOwnedAuthzField, {
      relativePath: "src/components/profile.tsx",
      content: `import { setDoc, doc } from "firebase/firestore";\nexport const saveName = (uid, name) => setDoc(doc(db, "users", uid), { displayName: name });\nexport const useRole = () => useContext(AuthContext).role;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a role field inside the write call's own object", () => {
    const findings = runScanRule(firebaseClientOwnedAuthzField, {
      relativePath: "src/components/profile.tsx",
      content: `import { setDoc, doc } from "firebase/firestore";\nexport const save = (uid) => setDoc(doc(db, "users", uid), { displayName: "x", role: "admin" });\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  // FN wave 5: a `;` inside a string literal within the write's own args must
  // not truncate the statement window before the authz field.
  it("flags a role field after a semicolon inside a string in the write's own args", () => {
    const findings = runScanRule(firebaseClientOwnedAuthzField, {
      relativePath: "src/components/profile.tsx",
      content: `import { setDoc, doc } from "firebase/firestore";\nexport const save = (uid) => setDoc(doc(db, "users", uid), { note: "a;b", role: "admin" });\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
