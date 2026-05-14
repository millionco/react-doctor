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
    "forwardRef is no longer needed on React 19+ — refs are regular props on function components; remove forwardRef and pass ref directly",
  ],
  [
    "useContext",
    "useContext is superseded by `use()` on React 19+ — `use()` reads context conditionally inside hooks, branches, and loops; switch to `import { use } from 'react'`",
  ],
]);

export const noReact19DeprecatedApis = defineRule<Rule>({
  id: "no-react19-deprecated-apis",
  requires: ["react:19"],
  tags: ["test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Pass `ref` as a regular prop on function components — `forwardRef` is no longer needed in React 19+. Replace `useContext(X)` with `use(X)` for branch-aware context reads. Only enabled on projects detected as React 19+.",
  examples: [
    {
      before:
        "import { forwardRef } from 'react';\nconst Input = forwardRef((props, ref) => <input ref={ref} {...props} />);",
      after: "const Input = ({ ref, ...props }) => <input ref={ref} {...props} />;",
    },
  ],
  ...createDeprecatedReactImportRule({
    source: "react",
    messages: REACT_19_DEPRECATED_MESSAGES,
  }),
});
