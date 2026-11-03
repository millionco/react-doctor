import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { firebasePermissiveRules } from "./firebase-permissive-rules.js";

describe("security-scan/firebase-permissive-rules ownership conditions", () => {
  it.each([
    "request.auth != null && request.auth.uid == resource.data.ownerId;",
    "request.auth != null\n        && request.auth.uid == resource.data.ownerId;",
    "request.auth != null /* owner required */ && request.auth.uid == resource.data.ownerId;",
    "request.auth != null // owner required\n        && request.auth.uid == resource.data.ownerId;",
    "request.auth != null && request.auth.uid == resource.data.author_uid;",
  ])("does not report the complete ownership condition %s", (condition) => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /notes/{noteId} {
      allow read: if ${condition}
    }
  }
}`,
    });
    expect(findings).toEqual([]);
  });

  it.each([
    "request.auth != null;",
    "true;",
    "request.auth != null || request.auth.uid == resource.data.ownerId;",
    "true || request.auth.uid == resource.data.ownerId;",
    "request.auth != null && true;",
    "request.auth != null && request.auth.uid == resource.data.ownerId || true;",
    "request.auth != null && request.auth.uid == request.auth.uid;",
  ])("preserves the broad-access finding for %s", (condition) => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `allow read: if ${condition}`,
    });
    expect(findings).toEqual([
      {
        message:
          "Firebase rules grant broad access to everyone or to any signed-in user, which is the Chattr/Firewreck failure mode.",
        line: 1,
        column: 1,
      },
    ]);
  });

  it.each([
    "request.auth != null && request.auth.uid == resource.data.ownerId.extra;",
    "request.auth != null && request.auth.uid == resource.data.ownerId[field];",
    "request.auth != null && request.auth.uid == resource.data.ownerId();",
    "request.auth != null && resource.data.ownerId == request.auth.uid;",
    "request.auth != null && (request.auth.uid == resource.data.ownerId);",
    "request.auth != null && request.auth.uid == resource.data.ownerId && resource.data.active;",
  ])("retains the existing result outside the bounded exemption for %s", (condition) => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `allow read: if ${condition}`,
    });
    expect(findings).toHaveLength(1);
  });

  it("locates an unsafe statement after a protected statement", () => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /notes/{noteId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow write: if request.auth != null;
    }
  }
}`,
    });
    expect(findings).toEqual([
      {
        message:
          "Firebase rules grant broad access to everyone or to any signed-in user, which is the Chattr/Firewreck failure mode.",
        line: 6,
        column: 7,
      },
    ]);
  });

  it("does not let an ownership condition suppress an earlier unsafe statement", () => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `allow write: if true;
allow read: if request.auth != null && request.auth.uid == resource.data.ownerId;`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 1, column: 1 });
  });

  it("preserves comment stripping when selecting the unsafe statement", () => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `// allow read: if true;
allow read: if request.auth != null && request.auth.uid == resource.data.ownerId;
/* allow write: if request.auth != null; */
allow write: if true;`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 4, column: 1 });
  });

  it("keeps the Firebase file predicate", () => {
    expect(
      runScanRule(firebasePermissiveRules, {
        relativePath: "notes.txt",
        content: "allow read: if true;",
      }),
    ).toEqual([]);
  });
});
