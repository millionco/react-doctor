import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const localRpcNativeBridgeRisk = defineRule({
  id: "local-rpc-native-bridge-risk",
  title: "Weak localhost native bridge boundary",
  severity: "warn",
  recommendation:
    "Use exact origin allowlists after URL parsing, per-request nonces, narrow methods, and never expose install/update commands to arbitrary web pages.",
  // Generic verbs (includes/indexOf/install/update) match dev-server helpers
  // and ordinary state updates — only native-capability commands count.
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern:
      /\b(?:Access-Control-Allow-Origin|websocket|WebSocket|(?:127\.0\.0\.1|localhost)(?=[\s\S]{0,700}\b(?:UpdateApp|InstallApp)\b)|(?:127\.0\.0\.1|localhost)[\s\S]{0,350}\b(?:onmessage|message|request|req)\b)\b[\s\S]{0,700}(?:\b(?:UpdateApp|InstallApp|child_process)\b|(?<![.\w$])(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?)\s*\()/i,
    message:
      "Code appears to bridge browser code to localhost/native capabilities with weak origin or update/install checks.",
  }),
});
