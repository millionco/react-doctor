import type { FnMiningCase } from "../fn-mining-case.js";
import { altTextCases } from "./alt-text.js";
import { authTokenInWebStorageCases } from "./auth-token-in-web-storage.js";
import { clickEventsHaveKeyEventsCases } from "./click-events-have-key-events.js";
import { dangerousHtmlSinkCases } from "./dangerous-html-sink.js";
import { jsHoistRegexpCases } from "./js-hoist-regexp.js";
import { jsxNoNewFunctionAsPropCases } from "./jsx-no-new-function-as-prop.js";
import { labelHasAssociatedControlCases } from "./label-has-associated-control.js";
import { noArrayIndexAsKeyCases } from "./no-array-index-as-key.js";
import { noDerivedStateEffectCases } from "./no-derived-state-effect.js";
import { noFetchInEffectCases } from "./no-fetch-in-effect.js";
import { queryNoQueryInEffectCases } from "./query-no-query-in-effect.js";
import { queryNoRestDestructuringCases } from "./query-no-rest-destructuring.js";
import { rerenderLazyStateInitCases } from "./rerender-lazy-state-init.js";
import { rnNoDimensionsGetCases } from "./rn-no-dimensions-get.js";
import { rnNoScrollviewMappedListCases } from "./rn-no-scrollview-mapped-list.js";

export const allFnMiningCases: FnMiningCase[] = [
  ...altTextCases,
  ...authTokenInWebStorageCases,
  ...clickEventsHaveKeyEventsCases,
  ...dangerousHtmlSinkCases,
  ...jsHoistRegexpCases,
  ...jsxNoNewFunctionAsPropCases,
  ...labelHasAssociatedControlCases,
  ...noArrayIndexAsKeyCases,
  ...noDerivedStateEffectCases,
  ...noFetchInEffectCases,
  ...queryNoQueryInEffectCases,
  ...queryNoRestDestructuringCases,
  ...rerenderLazyStateInitCases,
  ...rnNoDimensionsGetCases,
  ...rnNoScrollviewMappedListCases,
];
