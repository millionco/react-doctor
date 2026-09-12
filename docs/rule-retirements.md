# Rule retirements and optional checks

Default diagnostics should identify a specific defect. Code style, library migration, and unmeasured performance advice need an explicit user choice.

This change retires 33 rule IDs: 20 previously enabled by default, 12 optional visual or writing rules, and the optional `no-multi-comp` compatibility ID. It also makes 26 rules optional. Framework and capability gates still apply.

## Compatibility

Retired IDs remain registered through `defineRetiredRule`. They produce no diagnostics even when an existing configuration enables them. Optional AST rules retain their detectors and can be enabled through `severityControls.rules["react-doctor/<id>"]`. The four optional file-scan observations remain available through an explicit `checkSecurityScan` review with `includedTags: new Set(["security-scan"])` and `includeTagDefaults: true`.

## Retired IDs

| Rule                                       | Reason                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `activity-wraps-effect-heavy-subtree`      | Activity intentionally cleans up effects while hidden and preserves component state.                                                      |
| `client-localstorage-no-version`           | Storage can keep its version in the payload or use a separate migration path.                                                             |
| `design-no-em-dash-in-jsx-text`            | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `design-no-three-period-ellipsis`          | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `hooks-no-nan-in-deps`                     | React compares dependencies with Object.is. A stable NaN dependency does not establish a defect.                                          |
| `js-early-exit`                            | Nested conditions do not establish a performance defect or a safe early return.                                                           |
| `js-tosorted-immutable`                    | Both sorted-copy forms create an array. Prefer one only for an explicit compatibility or measured performance reason.                     |
| `no-children-prop`                         | Passing children explicitly is valid when it does not conflict with nested children.                                                      |
| `no-common-root-font`                      | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-default-purple-page-gradient`          | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-default-warm-page-surface`             | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-full-viewport-centered-hero`           | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-hero-eyebrow-chip`                     | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-icon-tile-heading-stack`               | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-italic-serif-display-heading`          | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-jsx-element-type`                      | A component can intentionally promise an element return value. Widen its type only when its return values require it.                     |
| `no-many-boolean-props`                    | Boolean prop count does not establish invalid state combinations or a defective API.                                                      |
| `no-monotonous-page-spacing`               | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-multi-comp`                            | Component count does not establish that splitting a module improves maintenance.                                                          |
| `no-multi-component-file`                  | Component count does not establish that splitting a module improves maintenance.                                                          |
| `no-numbered-section-markers`              | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-polymorphic-children`                  | Accepting text and element children can be an intentional component contract.                                                             |
| `no-pure-black-background`                 | Visual and writing preferences belong in an explicit design guide, not a general defect check.                                            |
| `no-render-prop-children`                  | Multiple render slots can be an intentional component API.                                                                                |
| `no-scale-from-zero`                       | A zero scale endpoint is an animation design choice, not a proven defect.                                                                 |
| `prefer-explicit-variants`                 | Boolean branches do not prove that separate variant components are easier to maintain.                                                    |
| `react-compiler-no-manual-memoization`     | Compiler availability does not prove that existing manual memoization is redundant. Check its purpose and performance before removing it. |
| `rendering-animate-svg-wrapper`            | An SVG animate prop does not prove slow animation, and a wrapper cannot replace SVG attribute animation.                                  |
| `rendering-usetransition-loading`          | A loading state name does not establish expensive non-urgent work that should use a transition.                                           |
| `rn-no-set-native-props`                   | React Native supports setNativeProps under the New Architecture.                                                                          |
| `rn-no-single-element-style-array`         | A one-item style array does not establish a meaningful performance cost.                                                                  |
| `rn-prefer-reanimated`                     | An Animated import does not prove that an animation runs on the JavaScript thread.                                                        |
| `tanstack-start-no-direct-fetch-in-loader` | A loader can fetch public client-capable data directly. A fetch call alone does not require a server function.                            |

## Optional checks

| Rule                                     | Use when                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `agent-tool-capability-risk`             | An explicit security review needs an inventory of capabilities and policy assumptions.                                  |
| `artifact-baas-authority-surface`        | An explicit security review needs an inventory of capabilities and policy assumptions.                                  |
| `firebase-query-filter-as-auth`          | An explicit security review needs an inventory of capabilities and policy assumptions.                                  |
| `js-cache-property-access`               | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `js-combine-iterations`                  | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `js-flatmap-filter`                      | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `js-length-check-first`                  | The user has checked the missing semantic context. The detector needs a narrower contract before returning to defaults. |
| `jsx-max-depth`                          | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `mcp-tool-capability-risk`               | An explicit security review needs an inventory of capabilities and policy assumptions.                                  |
| `nextjs-no-client-fetch-for-server-data` | The user has checked the missing semantic context. The detector needs a narrower contract before returning to defaults. |
| `nextjs-no-img-element`                  | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `no-barrel-import`                       | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `no-impure-call-at-module-scope`         | The user has checked the missing semantic context. The detector needs a narrower contract before returning to defaults. |
| `no-usememo-simple-expression`           | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `prefer-module-scope-pure-function`      | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `prefer-module-scope-static-value`       | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `prefer-useReducer`                      | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rendering-hoist-jsx`                    | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rendering-svg-precision`                | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rn-bottom-sheet-prefer-native`          | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rn-no-non-native-navigator`             | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rn-no-panresponder`                     | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rn-prefer-expo-image`                   | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `rn-prefer-pressable`                    | The user requests this cleanup or migration and checks behavior and cost.                                               |
| `server-dedup-props`                     | The user has checked the missing semantic context. The detector needs a narrower contract before returning to defaults. |
| `zod-v4-prefer-top-level-string-formats` | The user requests this cleanup or migration and checks behavior and cost.                                               |

## Evidence and limits

The initial audit screened 787 registered rules and ran 53 AST probes, three security scan probes, and 18 selected detectors over 500 files from five pinned public repositories. Its 201 raw reports were not a false-positive rate or a measured performance result. The implementation was refreshed against current main, which has 906 registered rules.

Upstream now honors React Compiler opt-out directives. Retirement of `react-compiler-no-manual-memoization` is based on the remaining lack of proof that existing memoization is redundant. Upstream also moved the default component-count check to `no-multi-component-file`; both component-count IDs are retired here.

A previously firing example for every retired ID is retained in `packages/oxlint-plugin-react-doctor/src/test-utils/retired-rule-cases.json`. The former liveness examples also assert silence. Default CLI and preset tests cover activation, while the retained optional detectors keep their existing unit tests.

## Primary references

- [React Native direct manipulation](https://reactnative.dev/docs/the-new-architecture/direct-manipulation-new-architecture)
- [React Native animations and the native driver](https://reactnative.dev/docs/animations)
- [React Compiler and existing memoization](https://react.dev/learn/react-compiler/introduction)
- [React Activity effect cleanup and state preservation](https://react.dev/reference/react/Activity)
- [React dependency comparison](https://react.dev/reference/react/useEffect)
- [Firestore query and security-rule constraints](https://firebase.google.com/docs/firestore/security/rules-query)

## Follow-up

The audit found four overlapping pairs: nested-component checks, numeric `&&` rendering checks, React Native shadow checks, and memoized-object-prop checks. Their source spans and exceptions differ. This PR retains those detectors; consolidation needs a shared diagnostic contract and tests that preserve distinct defects. The four narrowed-contract candidates above remain optional while that work is defined.
