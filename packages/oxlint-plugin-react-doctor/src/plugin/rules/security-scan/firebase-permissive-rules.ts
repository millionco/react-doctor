import { defineRule } from "../../utils/define-rule.js";
import { isFirebaseRulesPath } from "./utils/is-firebase-rules-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const firebasePermissiveRules = defineRule({
  id: "firebase-permissive-rules",
  title: "Permissive Firebase security rule",
  severity: "error",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Bind every read/write to `request.auth.uid`, immutable ownership, and tenant membership instead of treating sign-in as authorization.",
  scan: scanByPattern({
    shouldScan: (file) => isFirebaseRulesPath(file.relativePath),
    pattern:
      /allow\s+(?:read|write|create|update|delete|list|get|read,\s*write)\s*:\s*if\s+(?:true|request\.auth\s*!=\s*null)\s*;?/i,
    message:
      "Firebase rules grant broad access to everyone or to any signed-in user, which is the Chattr/Firewreck failure mode.",
  }),
});
