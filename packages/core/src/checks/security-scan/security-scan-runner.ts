import * as Context from "effect/Context";
import { checkSecurityScanCooperative } from "../../check-security-scan.js";

export class SecurityScanRunner extends Context.Reference<typeof checkSecurityScanCooperative>(
  "react-doctor/SecurityScanRunner",
  { defaultValue: () => checkSecurityScanCooperative },
) {}
