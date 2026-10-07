import { CACHE_DISABLED_VALUES } from "./constants.js";

export const isCacheGloballyDisabled = (): boolean =>
  CACHE_DISABLED_VALUES.has(process.env.REACT_DOCTOR_NO_CACHE?.toLowerCase() ?? "");
