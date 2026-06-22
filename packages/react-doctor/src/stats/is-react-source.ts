// JSX-bearing extensions imply a React (or React-like) component in this
// product's universe — `.ts`/`.js` cannot hold JSX, so they need a content
// signal instead.
const JSX_EXTENSION_PATTERN = /\.(tsx|jsx)$/;

// `"use client"` / `"use server"` directives mark React Server Component
// boundaries and server actions — React code even without a `react` import.
const REACT_DIRECTIVE_PATTERN = /^\s*['"]use (?:client|server)['"]/m;

// Every `from "…"`, `require("…")`, and `import("…")` specifier in a file.
const MODULE_SPECIFIER_PATTERN = /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;

// React framework packages that don't carry "react" in their name.
const REACT_FRAMEWORK_ROOTS = ["next", "expo", "gatsby", "@remix-run", "@shopify/hydrogen"];

const isReactModuleSpecifier = (specifier: string): boolean => {
  const lower = specifier.toLowerCase();
  if (lower === "react" || lower.startsWith("react/") || lower.startsWith("react-")) return true;
  // Scoped/nested React packages: `@tanstack/react-query`, `@react-navigation/native`, …
  if (lower.includes("/react-") || lower.endsWith("/react") || lower.startsWith("@react-")) {
    return true;
  }
  if (lower === "preact" || lower.startsWith("preact/")) return true;
  return REACT_FRAMEWORK_ROOTS.some((root) => lower === root || lower.startsWith(`${root}/`));
};

/**
 * Whether a reconstructed file is actually React code worth ranking. React
 * Doctor's rules are React-specific, so a model's plain backend/util/config
 * files would otherwise pad its file count and dilute its diagnostics-per-file
 * — skewing the leaderboard toward whoever wrote the most non-React code. A
 * file qualifies when it has a JSX extension, a `use client`/`use server`
 * directive, or imports from the React ecosystem.
 */
export const isReactSourceFile = (filePath: string, content: string): boolean => {
  if (JSX_EXTENSION_PATTERN.test(filePath)) return true;
  if (REACT_DIRECTIVE_PATTERN.test(content)) return true;
  for (const match of content.matchAll(MODULE_SPECIFIER_PATTERN)) {
    if (isReactModuleSpecifier(match[1])) return true;
  }
  return false;
};
