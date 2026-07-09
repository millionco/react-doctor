import { defineRule } from "../../utils/define-rule.js";
import { createDeprecatedReactImportRule } from "./utils/create-deprecated-react-import-rule.js";
import type { ReportDescriptor } from "../../utils/report-descriptor.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// HACK: React 19+ deprecated `forwardRef` (refs are now regular props on
// function components). Catches both named imports
// (`import { forwardRef } from "react"`) AND member access on
// namespace/default imports (`React.forwardRef` after
// `import React from "react"` or `import * as React from "react"`).
//
// `useContext` is deliberately NOT in this map: React 19's `use()` is an
// additive alternative, and `useContext` remains a fully supported,
// non-deprecated API — calling it deprecated was reward-deciding
// misinformation in downstream audits.
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
]);

// shadcn/ui vendors generated components under `components/ui/` — code the
// user copied in, not authored. Those files use `forwardRef` heavily (5-8×
// per file across dozens of files), and the actionable fix is regenerating
// from shadcn's React-19 registry, not hand-editing each callsite — so the
// per-callsite migration hint is pure noise there.
const isVendoredShadcnUiFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = rawFilename.replaceAll("\\", "/");
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  return rootedFilename.includes("/components/ui/");
};

const deprecatedReactImportRule = createDeprecatedReactImportRule({
  source: "react",
  messages: REACT_19_DEPRECATED_MESSAGES,
});

// Each deprecated API maps to exactly one message string, so keying the
// dedupe on `descriptor.message` caps reporting at one diagnostic per
// deprecated API per file. Fixing the file fixes every occurrence at once;
// repeating the identical hint 5× in one file is density, not signal.
// Getter delegation (not spread) keeps the host context's lazy `scopes` /
// `cfg` getters lazy.
const buildOncePerApiContext = (context: RuleContext): RuleContext => {
  const reportedMessages = new Set<string>();
  return {
    report: (descriptor: ReportDescriptor) => {
      if (reportedMessages.has(descriptor.message)) return;
      reportedMessages.add(descriptor.message);
      context.report(descriptor);
    },
    get filename() {
      return context.filename;
    },
    get settings() {
      return context.settings;
    },
    get scopes() {
      return context.scopes;
    },
    get cfg() {
      return context.cfg;
    },
  };
};

export const noReact19DeprecatedApis = defineRule({
  id: "no-react19-deprecated-apis",
  title: "React 19 API migration can break callers",
  requires: ["react:19"],
  // BOTH tags — migration-hint wins, see no-react-dom-deprecated-apis.
  tags: ["test-noise", "migration-hint"],
  severity: "warn",
  recommendation:
    "Pass `ref` as a normal prop on function components, since `forwardRef` isn't needed in React 19. Only runs on React 19+ projects.",
  create: (context: RuleContext): RuleVisitors => {
    if (isVendoredShadcnUiFilename(context.filename)) return {};
    return deprecatedReactImportRule.create(buildOncePerApiContext(context));
  },
});
