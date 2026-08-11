import { createRuleSuppression } from "./utils/create-rule-suppression.js";

// Codebases that migrated from eslint-plugin-react-hooks carry
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments on
// deliberately mount-only effects. The rule's own docs point authors at
// linter suppressions for intentional exclusions, so honoring the
// upstream rule name (which oxlint's own disable-comment handling does
// NOT match against our `react-doctor/exhaustive-deps` id) keeps those
// documented opt-outs working instead of re-reporting them.
const exhaustiveDepsSuppression = createRuleSuppression("exhaustive-deps");

export const isExhaustiveDepsSuppressedAt = exhaustiveDepsSuppression.isSuppressedAt;
export const clearExhaustiveDepsSuppressionCache = exhaustiveDepsSuppression.clearCache;
