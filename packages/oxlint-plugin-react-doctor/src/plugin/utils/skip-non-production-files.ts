import { isTestlikeFilename } from "./is-testlike-filename.js";
import type { RuleContext } from "./rule-context.js";
import type { RuleVisitors } from "./rule-visitors.js";

// Wrap a rule's `create` so it produces no visitors in non-production files
// (tests, specs, fixtures, stories, scripts, …). Used by `defineRule` for the
// `test-noise` tag and directly by rules whose finding is only actionable in
// code that ships to users — e.g. the security rules, where `eval` /
// `new Function` / a token in web storage is not a real vulnerability in test
// scaffolding that never reaches a browser.
export const skipNonProductionFiles =
  (create: (context: RuleContext) => RuleVisitors) =>
  (context: RuleContext): RuleVisitors =>
    isTestlikeFilename(context.filename) ? {} : create(context);
