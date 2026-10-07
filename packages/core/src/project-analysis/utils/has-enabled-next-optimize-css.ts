import { evaluateStaticConfig } from "./evaluate-static-config.js";

const isStaticObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const hasEnabledNextOptimizeCss = (content: string): boolean => {
  const config = evaluateStaticConfig(content, "next.config.ts");
  if (!isStaticObject(config) || !isStaticObject(config.experimental)) return false;
  return config.experimental.optimizeCss === true;
};
