import { RUNTIME_SCAN_CONTROL_CHARACTERS_PATTERN } from "./constants.js";

export const sanitizeRuntimeText = (value: string): string =>
  value.replace(RUNTIME_SCAN_CONTROL_CHARACTERS_PATTERN, "");
