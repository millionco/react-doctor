import { EXHAUSTIVE_DEPS_DIVERGENCES } from "./__upstream-fixtures__/divergences.js";
import { runUpstreamParity } from "./__upstream-fixtures__/run-upstream-parity.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

// Upstream-parity suite for `react-doctor/exhaustive-deps`. Replays
// every `tests` / `testsTypescript` / `testsFlow` case from
// `eslint-plugin-react-hooks`'s `ESLintRuleExhaustiveDeps-test.js`
// against our port via the `runRule` harness.
//
// Upstream's `options[0]` shape:
//   { additionalHooks: "(useCustomHook)", enableDangerousAutofix… }
// is translated below into our `settings["react-doctor"].exhaustiveDeps`
// shape so the rule sees the right config.
runUpstreamParity("exhaustive-deps", exhaustiveDeps, {
  validSkips: EXHAUSTIVE_DEPS_DIVERGENCES.validSkips,
  invalidSkips: EXHAUSTIVE_DEPS_DIVERGENCES.invalidSkips,
  invalidDiagnosticCountOverrides: EXHAUSTIVE_DEPS_DIVERGENCES.invalidDiagnosticCountOverrides,
  translateOptions: (upstreamOptions) => {
    if (!upstreamOptions || upstreamOptions.length === 0) return undefined;
    const firstOption = upstreamOptions[0];
    if (typeof firstOption !== "object" || firstOption === null) return undefined;
    return {
      "react-doctor": {
        exhaustiveDeps: firstOption as Readonly<Record<string, unknown>>,
      },
    };
  },
});
