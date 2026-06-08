import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import { createDeprecatedReactImportRule } from "./utils/create-deprecated-react-import-rule.js";

// HACK: React 19+ deprecated `forwardRef` (refs are now regular props on
// function components) and `useContext` (replaced by the more flexible
// `use()`). Catches both named imports (`import { forwardRef } from "react"`)
// AND member access on namespace/default imports (`React.forwardRef`,
// `React.useContext` after `import React from "react"` or
// `import * as React from "react"`).
//
// Stored as a Map (not a plain object) because plain-object lookups inherit
// from `Object.prototype` — `messages["constructor"]` returns the native
// `Object` function, which is truthy and would silently false-positive on
// `import { constructor } from "react"` or `React.toString()`. Maps return
// `undefined` for missing keys with no prototype fall-through.
const REACT_19_DEPRECATED_MESSAGES = new Map<string, string>([
  [
    "forwardRef",
    "forwardRef is dead weight in React 19, since ref is a normal prop now, so drop it & pass ref straight through.",
  ],
  [
    "useContext",
    "useContext is replaced by `use()` in React 19, which reads context inside ifs & loops too, so switch to `import { use } from 'react'`.",
  ],
]);

export const noReact19DeprecatedApis = defineRule<Rule>({
  id: "no-react19-deprecated-apis",
  title: "React 19 API migration can break callers",
  requires: ["react:19"],
  // BOTH tags — migration-hint wins, see no-react-dom-deprecated-apis.
  tags: ["test-noise", "migration-hint"],
  severity: "warn",
  recommendation:
    "Pass `ref` as a normal prop on function components, since `forwardRef` isn't needed in React 19. Replace `useContext(X)` with `use(X)`. Only runs on React 19+ projects.",
  ...createDeprecatedReactImportRule({
    source: "react",
    messages: REACT_19_DEPRECATED_MESSAGES,
  }),
});
