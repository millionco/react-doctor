// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noDocumentStartViewTransition } from "./../rules/view-transitions/no-document-start-view-transition.js";
import { noFlushSync } from "./../rules/view-transitions/no-flush-sync.js";

export const ViewTransitionsRuleEntries = [
  {
    key: "react-doctor/no-document-start-view-transition",
    id: "no-document-start-view-transition",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDocumentStartViewTransition,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-flush-sync",
    id: "no-flush-sync",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noFlushSync,
      framework: "global",
      category: "Performance",
    },
  },
] as const;
