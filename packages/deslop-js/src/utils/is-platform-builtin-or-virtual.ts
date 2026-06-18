import { BUILTIN_MODULES } from "../constants.js";

const BUILTIN_SUBPATH_NODE_MODULES = new Set<string>([
  "fs",
  "dns",
  "stream",
  "readline",
  "timers",
  "util",
  "test",
  "assert",
  "inspector",
  "path",
]);

/**
 * True for module specifiers that don't correspond to a real on-disk
 * package — Node / Bun / Cloudflare / Sass built-ins, the Deno `std`
 * bare specifier, and Vite `virtual:` modules — so they aren't mistakenly
 * surfaced as `unused-dependency` or `unresolved-import`.
 */
export const isPlatformBuiltinOrVirtualSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith("virtual:")) return true;
  if (specifier === "bun" || specifier.startsWith("bun:")) return true;
  if (specifier.startsWith("cloudflare:")) return true;
  if (specifier.startsWith("sass:")) return true;
  if (specifier === "std" || specifier.startsWith("std/")) return true;

  const stripped = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const slashIndex = stripped.indexOf("/");
  if (slashIndex === -1) return BUILTIN_MODULES.has(stripped);
  const baseName = stripped.slice(0, slashIndex);
  if (!BUILTIN_MODULES.has(baseName)) return false;
  return BUILTIN_SUBPATH_NODE_MODULES.has(baseName);
};
