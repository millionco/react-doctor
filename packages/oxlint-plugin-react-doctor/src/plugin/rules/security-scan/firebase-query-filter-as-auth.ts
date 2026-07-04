import { defineRule } from "../../utils/define-rule.js";
import { isClientSourcePath } from "./utils/is-client-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const firebaseQueryFilterAsAuth = defineRule({
  id: "firebase-query-filter-as-auth",
  title: "Firestore query filter used as authorization",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Make sure Firestore rules compare the requested document against `request.auth.uid` and trusted membership data.",
  scan: scanByPattern({
    shouldScan: (file) => isClientSourcePath(file.relativePath),
    pattern:
      /\.where\s*\(\s*["'](?:uid|userId|userID|ownerId|ownerID|orgId|orgID|tenantId|tenantID|role)["']\s*,\s*["']==["']/i,
    message:
      "Firestore query code filters by an auth-shaped field; filtering is not authorization unless rules enforce the same boundary.",
  }),
});
