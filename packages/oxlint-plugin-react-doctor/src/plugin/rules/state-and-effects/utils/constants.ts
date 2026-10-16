export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const FRAME_CANCELLATION_RECEIVER_NAMES = new Set(["window", "globalThis", "self"]);
export const FRAME_CANCELLATION_EXPOSED_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "window",
  "globalThis",
  "self",
  "global",
  "top",
  "parent",
  "frames",
]);
