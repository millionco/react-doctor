import { defineRule } from "../../utils/define-rule.js";
import { isClientSourcePath } from "./utils/is-client-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// `updateDoc`/`.collection(...).update(...)` are common method names on
// in-house data writers too; the file must show client-database evidence
// (in its path or content) before its writes count as client-owned authz
// fields. `setDoc`/`addDoc` are firestore-specific; bare `updateDoc` is not.
const CLIENT_DATABASE_EVIDENCE_PATTERN = /firebase|firestore|supabase|\b(?:setDoc|addDoc)\s*\(/i;

export const firebaseClientOwnedAuthzField = defineRule({
  id: "firebase-client-owned-authz-field",
  title: "Client writes authorization field",
  severity: "error",
  recommendation:
    "Derive authority fields on the server or enforce them in Firebase/Supabase rules; never trust client-provided owner, org, or role values.",
  scan: scanByPattern({
    shouldScan: (file) =>
      isClientSourcePath(file.relativePath) &&
      (CLIENT_DATABASE_EVIDENCE_PATTERN.test(file.content) ||
        CLIENT_DATABASE_EVIDENCE_PATTERN.test(file.relativePath)),
    pattern:
      /(?:\b(?:setDoc|updateDoc|addDoc)\s*\(|(?:\b(?:firebase|firestore|getFirestore)\b|\bcollection\s*\(|\.collection\s*\()[\s\S]{0,500}\.(?:set|update|add)\s*\()[\s\S]{0,700}\b(?:ownerId|ownerID|creatorId|creatorID|providerId|providerID|orgId|orgID|tenantId|tenantID|workspaceId|workspaceID|ghostOrg|role|roles|isAdmin)\b/i,
    message:
      "Client code writes an ownership, tenant, or role field that should be server-owned and immutable.",
  }),
});
