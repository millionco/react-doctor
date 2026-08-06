import { createRuleSuppression } from "./utils/create-rule-suppression.js";

// Codebases that migrated from eslint-plugin-react-hooks carry
// `eslint-disable-next-line react-hooks/rules-of-hooks` comments on
// deliberately guarded hooks (e.g. a useEffect behind a build-time
// `isDevelopment` constant, where hook order is identical on every render
// of a given build). oxlint's own disable-comment handling only matches
// our `react-doctor/rules-of-hooks` id, so the upstream rule name must be
// honored here to keep those documented opt-outs working.
const rulesOfHooksSuppression = createRuleSuppression("rules-of-hooks");

export const isRulesOfHooksSuppressedAt = rulesOfHooksSuppression.isSuppressedAt;
export const clearRulesOfHooksSuppressionCache = rulesOfHooksSuppression.clearCache;
