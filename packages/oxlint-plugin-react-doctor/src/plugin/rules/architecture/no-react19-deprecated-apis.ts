import { defineRule } from "../../utils/define-rule.js";
import { createDeprecatedReactImportRule } from "./utils/create-deprecated-react-import-rule.js";
import type { ReportDescriptor } from "../../utils/report-descriptor.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// Stored as a Map (not a plain object) because plain-object lookups inherit
// from `Object.prototype` — `messages["constructor"]` returns the native
// `Object` function, which is truthy and would silently false-positive on
// `import { constructor } from "react"` or `React.toString()`. Maps return
// `undefined` for missing keys with no prototype fall-through.
const REACT_19_DEPRECATED_MESSAGES = new Map<string, string>([
  ["createFactory", "React 19 removed createFactory. Use JSX or createElement instead."],
]);

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
    "Replace removed React APIs with their supported React 19 alternatives. Only runs on React 19+ projects.",
  create: (context: RuleContext): RuleVisitors =>
    deprecatedReactImportRule.create(buildOncePerApiContext(context)),
});
