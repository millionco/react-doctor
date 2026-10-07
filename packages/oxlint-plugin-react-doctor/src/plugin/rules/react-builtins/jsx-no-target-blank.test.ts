// GENERATED — do not edit by hand. Run `pnpm gen:fixture-tests` to
// regenerate. Hand-written regression tests live in
// `jsx-no-target-blank.regressions.test.ts` and survive regeneration.

import { runOxcFixtures } from "../../../test-utils/run-fixtures.js";
import { failCases, passCases } from "./__fixtures__/jsx-no-target-blank.fixtures.js";
import { DIVERGENCES } from "./__fixtures__/oxc-divergences.js";
import { TRANSLATORS } from "./__fixtures__/oxc-settings-translators.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const divergence = DIVERGENCES["jsx-no-target-blank"];
runOxcFixtures(
  "react-builtins/jsx-no-target-blank",
  jsxNoTargetBlank,
  { passCases, failCases },
  {
    translateOxcFixture: TRANSLATORS["jsx-no-target-blank"],
    knownPassDivergences: divergence?.passSkips,
    knownFailDivergences: divergence?.failSkips,
  },
);
