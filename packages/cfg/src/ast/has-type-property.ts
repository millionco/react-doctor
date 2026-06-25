import type { ValueWithType } from "./value-with-type.js";

export const hasTypeProperty = (value: unknown): value is ValueWithType =>
  Boolean(value && typeof value === "object" && "type" in value);
