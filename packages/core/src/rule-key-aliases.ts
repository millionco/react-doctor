// Map from a rule key as it appeared in user configs BEFORE the OXC
// port (`react/<id>`, `jsx-a11y/<id>`, `react-hooks/<id>`,
// `react-refresh/<id>`, `react-perf/<id>`, `effect/<id>`) to the
// post-port canonical key (`react-doctor/<id>`).
//
// The map enables backward compatibility on every surface that takes
// rule keys from user config: `ignore.rules`, severity overrides in
// `rules`, the `buildDiagnosticPipeline` severity path, and inline-suppression
// matching via `isSameRuleKey`. Without an entry here, a user config
// targeting the old key silently no-ops after upgrade.
//
// NOTE: keep alphabetically sorted by source key for stable diffs and
// easy de-dup. Generated from `packages/oxlint-plugin-react-doctor/
// src/plugin/rules/` + a small manual baseline for react-doctor
// originals that previously shipped under non-`react-doctor/`
// namespaces (`effect/<id>` for the you-might-not-need-an-effect
// family).
const LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY: Readonly<Record<string, string>> = {
  "effect/no-adjust-state-on-prop-change": "react-doctor/no-adjust-state-on-prop-change",
  "effect/no-chain-state-updates": "react-doctor/no-chain-state-updates",
  "effect/no-derived-state": "react-doctor/no-derived-state",
  "effect/no-event-handler": "react-doctor/no-event-handler",
  "effect/no-initialize-state": "react-doctor/no-initialize-state",
  "effect/no-pass-data-to-parent": "react-doctor/no-pass-data-to-parent",
  "effect/no-pass-live-state-to-parent": "react-doctor/no-pass-live-state-to-parent",
  "effect/no-reset-all-state-on-prop-change": "react-doctor/no-reset-all-state-on-prop-change",
  "jsx-a11y/alt-text": "react-doctor/alt-text",
  "jsx-a11y/anchor-ambiguous-text": "react-doctor/anchor-ambiguous-text",
  "jsx-a11y/anchor-has-content": "react-doctor/anchor-has-content",
  "jsx-a11y/anchor-is-valid": "react-doctor/anchor-is-valid",
  "jsx-a11y/aria-activedescendant-has-tabindex": "react-doctor/aria-activedescendant-has-tabindex",
  "jsx-a11y/aria-props": "react-doctor/aria-props",
  "jsx-a11y/aria-proptypes": "react-doctor/aria-proptypes",
  "jsx-a11y/aria-role": "react-doctor/aria-role",
  "jsx-a11y/aria-unsupported-elements": "react-doctor/aria-unsupported-elements",
  "jsx-a11y/autocomplete-valid": "react-doctor/autocomplete-valid",
  "jsx-a11y/click-events-have-key-events": "react-doctor/click-events-have-key-events",
  "jsx-a11y/control-has-associated-label": "react-doctor/control-has-associated-label",
  "jsx-a11y/heading-has-content": "react-doctor/heading-has-content",
  "jsx-a11y/html-has-lang": "react-doctor/html-has-lang",
  "jsx-a11y/iframe-has-title": "react-doctor/iframe-has-title",
  "jsx-a11y/img-redundant-alt": "react-doctor/img-redundant-alt",
  "jsx-a11y/interactive-supports-focus": "react-doctor/interactive-supports-focus",
  "jsx-a11y/label-has-associated-control": "react-doctor/label-has-associated-control",
  "jsx-a11y/lang": "react-doctor/lang",
  "jsx-a11y/media-has-caption": "react-doctor/media-has-caption",
  "jsx-a11y/mouse-events-have-key-events": "react-doctor/mouse-events-have-key-events",
  "jsx-a11y/no-access-key": "react-doctor/no-access-key",
  "jsx-a11y/no-aria-hidden-on-focusable": "react-doctor/no-aria-hidden-on-focusable",
  "jsx-a11y/no-autofocus": "react-doctor/no-autofocus",
  "jsx-a11y/no-distracting-elements": "react-doctor/no-distracting-elements",
  "jsx-a11y/no-interactive-element-to-noninteractive-role":
    "react-doctor/no-interactive-element-to-noninteractive-role",
  "jsx-a11y/no-noninteractive-element-interactions":
    "react-doctor/no-noninteractive-element-interactions",
  "jsx-a11y/no-noninteractive-element-to-interactive-role":
    "react-doctor/no-noninteractive-element-to-interactive-role",
  "jsx-a11y/no-noninteractive-tabindex": "react-doctor/no-noninteractive-tabindex",
  "jsx-a11y/no-redundant-roles": "react-doctor/no-redundant-roles",
  "jsx-a11y/no-static-element-interactions": "react-doctor/no-static-element-interactions",
  "jsx-a11y/prefer-tag-over-role": "react-doctor/prefer-tag-over-role",
  "jsx-a11y/role-has-required-aria-props": "react-doctor/role-has-required-aria-props",
  "jsx-a11y/role-supports-aria-props": "react-doctor/role-supports-aria-props",
  "jsx-a11y/scope": "react-doctor/scope",
  "jsx-a11y/tabindex-no-positive": "react-doctor/tabindex-no-positive",
  "react-hooks/exhaustive-deps": "react-doctor/exhaustive-deps",
  "react-hooks/rules-of-hooks": "react-doctor/rules-of-hooks",
  "react-perf/jsx-no-jsx-as-prop": "react-doctor/jsx-no-jsx-as-prop",
  "react-perf/jsx-no-new-array-as-prop": "react-doctor/jsx-no-new-array-as-prop",
  "react-perf/jsx-no-new-function-as-prop": "react-doctor/jsx-no-new-function-as-prop",
  "react-perf/jsx-no-new-object-as-prop": "react-doctor/jsx-no-new-object-as-prop",
  "react-refresh/only-export-components": "react-doctor/only-export-components",
  "react/button-has-type": "react-doctor/button-has-type",
  "react/checked-requires-onchange-or-readonly":
    "react-doctor/checked-requires-onchange-or-readonly",
  "react/display-name": "react-doctor/display-name",
  "react/exhaustive-deps": "react-doctor/exhaustive-deps",
  "react/forbid-component-props": "react-doctor/forbid-component-props",
  "react/forbid-dom-props": "react-doctor/forbid-dom-props",
  "react/forbid-elements": "react-doctor/forbid-elements",
  "react/forward-ref-uses-ref": "react-doctor/forward-ref-uses-ref",
  "react/hook-use-state": "react-doctor/hook-use-state",
  "react/iframe-missing-sandbox": "react-doctor/iframe-missing-sandbox",
  "react/jsx-boolean-value": "react-doctor/jsx-boolean-value",
  "react/jsx-curly-brace-presence": "react-doctor/jsx-curly-brace-presence",
  "react/jsx-filename-extension": "react-doctor/jsx-filename-extension",
  "react/jsx-fragments": "react-doctor/jsx-fragments",
  "react/jsx-handler-names": "react-doctor/jsx-handler-names",
  "react/jsx-key": "react-doctor/jsx-key",
  "react/jsx-max-depth": "react-doctor/jsx-max-depth",
  "react/jsx-no-comment-textnodes": "react-doctor/jsx-no-comment-textnodes",
  "react/jsx-no-constructed-context-values": "react-doctor/jsx-no-constructed-context-values",
  "react/jsx-no-duplicate-props": "react-doctor/jsx-no-duplicate-props",
  "react/jsx-no-jsx-as-prop": "react-doctor/jsx-no-jsx-as-prop",
  "react/jsx-no-new-array-as-prop": "react-doctor/jsx-no-new-array-as-prop",
  "react/jsx-no-new-function-as-prop": "react-doctor/jsx-no-new-function-as-prop",
  "react/jsx-no-new-object-as-prop": "react-doctor/jsx-no-new-object-as-prop",
  "react/jsx-no-script-url": "react-doctor/jsx-no-script-url",
  "react/jsx-no-undef": "react-doctor/jsx-no-undef",
  "react/jsx-no-useless-fragment": "react-doctor/jsx-no-useless-fragment",
  "react/jsx-pascal-case": "react-doctor/jsx-pascal-case",
  "react/jsx-props-no-spread-multi": "react-doctor/jsx-props-no-spread-multi",
  "react/jsx-props-no-spreading": "react-doctor/jsx-props-no-spreading",
  "react/no-array-index-key": "react-doctor/no-array-index-key",
  "react/no-children-prop": "react-doctor/no-children-prop",
  "react/no-clone-element": "react-doctor/no-clone-element",
  "react/no-danger": "react-doctor/no-danger",
  "react/no-danger-with-children": "react-doctor/no-danger-with-children",
  "react/no-did-mount-set-state": "react-doctor/no-did-mount-set-state",
  "react/no-did-update-set-state": "react-doctor/no-did-update-set-state",
  "react/no-direct-mutation-state": "react-doctor/no-direct-mutation-state",
  "react/no-find-dom-node": "react-doctor/no-find-dom-node",
  "react/no-is-mounted": "react-doctor/no-is-mounted",
  "react/no-multi-comp": "react-doctor/no-multi-comp",
  "react/no-namespace": "react-doctor/no-namespace",
  "react/no-react-children": "react-doctor/no-react-children",
  "react/no-redundant-should-component-update": "react-doctor/no-redundant-should-component-update",
  "react/no-render-return-value": "react-doctor/no-render-return-value",
  "react/no-set-state": "react-doctor/no-set-state",
  "react/no-string-refs": "react-doctor/no-string-refs",
  "react/no-this-in-sfc": "react-doctor/no-this-in-sfc",
  "react/no-unescaped-entities": "react-doctor/no-unescaped-entities",
  "react/no-unknown-property": "react-doctor/no-unknown-property",
  "react/no-unsafe": "react-doctor/no-unsafe",
  "react/no-unstable-nested-components": "react-doctor/no-unstable-nested-components",
  "react/no-will-update-set-state": "react-doctor/no-will-update-set-state",
  "react/only-export-components": "react-doctor/only-export-components",
  "react/prefer-es6-class": "react-doctor/prefer-es6-class",
  "react/prefer-function-component": "react-doctor/prefer-function-component",
  "react/react-in-jsx-scope": "react-doctor/react-in-jsx-scope",
  "react/require-render-return": "react-doctor/require-render-return",
  "react/rules-of-hooks": "react-doctor/rules-of-hooks",
  "react/self-closing-comp": "react-doctor/self-closing-comp",
  "react/state-in-constructor": "react-doctor/state-in-constructor",
  "react/style-prop-object": "react-doctor/style-prop-object",
  "react/void-dom-elements-no-children": "react-doctor/void-dom-elements-no-children",
};

const NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS = new Map<string, string[]>();
for (const [legacyRuleKey, nativeRuleKey] of Object.entries(LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY)) {
  const aliases = NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.get(nativeRuleKey) ?? [];
  aliases.push(legacyRuleKey);
  NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.set(nativeRuleKey, aliases);
}

const getLegacyRuleKeysForNative = (ruleKey: string): ReadonlyArray<string> =>
  NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.get(ruleKey) ?? [];

const canonicalizeRuleKey = (ruleKey: string): string =>
  LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY[ruleKey] ?? ruleKey;

export const isSameRuleKey = (candidateRuleKey: string, targetRuleKey: string): boolean =>
  canonicalizeRuleKey(candidateRuleKey) === canonicalizeRuleKey(targetRuleKey);

export const getEquivalentRuleKeys = (ruleKey: string): ReadonlyArray<string> => {
  const nativeRuleKey = canonicalizeRuleKey(ruleKey);
  return [nativeRuleKey, ...getLegacyRuleKeysForNative(nativeRuleKey)];
};
