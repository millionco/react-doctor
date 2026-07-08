// Translators that turn OXC's `Some(json!(...))` config payload into the
// `react-doctor.<rule>` settings shape our ports consume. The fixture
// extractor preserves OXC's payload verbatim as `oxcOptions` /
// `oxcSettings`; this module maps it to what our `create()` reads.
//
// Each translator gets the entry's full fixture (so it can read both
// `oxcOptions` and `oxcSettings` together) and returns the merged
// settings object — or null when the rule doesn't need translation.

export interface OxcFixtureLike {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

const passthroughTopLevelObject = (oxcOptions: unknown): Record<string, unknown> | null => {
  if (Array.isArray(oxcOptions) && oxcOptions.length > 0) {
    const first = oxcOptions[0];
    if (typeof first === "object" && first !== null) return first as Record<string, unknown>;
  }
  return null;
};

const oxcSettingsReactBlock = (oxcSettings: unknown): Record<string, unknown> | undefined => {
  if (typeof oxcSettings !== "object" || oxcSettings === null) return undefined;
  const block = (oxcSettings as { settings?: { react?: unknown } }).settings;
  if (!block) return undefined;
  const reactBlock = (block as { react?: unknown }).react;
  if (typeof reactBlock !== "object" || reactBlock === null) return undefined;
  return reactBlock as Record<string, unknown>;
};

const wrapForReactDoctor = (
  ruleSettingsKey: string,
  ruleSettings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!ruleSettings) return null;
  return { "react-doctor": { [ruleSettingsKey]: ruleSettings } };
};

// `[{ button: false, submit: true, reset: true }]` → `{ buttonHasType: { ... } }`
const buttonHasTypeTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("buttonHasType", passthroughTopLevelObject(fixture.oxcOptions));

// `[[{ name, props? } | name, ...], { includeFromSettings? }]`
// + linkComponents from settings.react.linkComponents
const jsxNoScriptUrlTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  const merged: Record<string, unknown> = {};
  if (Array.isArray(fixture.oxcOptions)) {
    const first = fixture.oxcOptions[0];
    const second = fixture.oxcOptions[1];
    if (Array.isArray(first)) {
      const components: Record<string, ReadonlyArray<string>> = {};
      for (const entry of first) {
        if (typeof entry === "object" && entry !== null) {
          const item = entry as { name?: string; props?: ReadonlyArray<string> };
          if (item.name && Array.isArray(item.props)) components[item.name] = item.props;
        }
      }
      if (Object.keys(components).length > 0) merged.components = components;
    } else if (
      typeof first === "object" &&
      first !== null &&
      "includeFromSettings" in (first as object)
    ) {
      const flag = (first as { includeFromSettings?: boolean }).includeFromSettings;
      if (flag !== undefined) merged.includeFromSettings = flag;
    }
    if (
      typeof second === "object" &&
      second !== null &&
      "includeFromSettings" in (second as object)
    ) {
      const flag = (second as { includeFromSettings?: boolean }).includeFromSettings;
      if (flag !== undefined) merged.includeFromSettings = flag;
    }
  }
  // OXC's `settings.react.linkComponents` array → `linkComponents` map.
  const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
  if (reactBlock && Array.isArray(reactBlock.linkComponents)) {
    const linkComponents: Record<string, ReadonlyArray<string>> = {};
    for (const entry of reactBlock.linkComponents) {
      if (typeof entry === "object" && entry !== null) {
        const item = entry as { name?: string; linkAttribute?: string | ReadonlyArray<string> };
        if (item.name && item.linkAttribute) {
          linkComponents[item.name] = Array.isArray(item.linkAttribute)
            ? item.linkAttribute
            : [item.linkAttribute];
        }
      }
    }
    if (Object.keys(linkComponents).length > 0) merged.linkComponents = linkComponents;
  }
  return Object.keys(merged).length > 0 ? wrapForReactDoctor("jsxNoScriptUrl", merged) : null;
};

const noUnknownPropertyTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  const top = passthroughTopLevelObject(fixture.oxcOptions);
  if (!top) return null;
  const settings: Record<string, unknown> = {};
  if (Array.isArray((top as { ignore?: unknown }).ignore)) {
    settings.ignore = (top as { ignore: ReadonlyArray<string> }).ignore;
  }
  if (typeof (top as { requireDataLowercase?: unknown }).requireDataLowercase === "boolean") {
    settings.requireDataLowercase = (top as { requireDataLowercase: boolean }).requireDataLowercase;
  }
  if (Object.keys(settings).length === 0) return null;
  return wrapForReactDoctor("noUnknownProperty", settings);
};

const jsxKeyTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxKey", passthroughTopLevelObject(fixture.oxcOptions));

const rulesOfHooksTranslator = (): Record<string, unknown> =>
  wrapForReactDoctor("rulesOfHooks", {
    allowedPascalCaseHookNamespaces: ["Sinon"],
  })!;

const displayNameTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  const settings = { ...(passthroughTopLevelObject(fixture.oxcOptions) ?? {}) };
  const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
  if (reactBlock && typeof reactBlock.version === "string") {
    settings.reactVersion = reactBlock.version;
  }
  return Object.keys(settings).length > 0 ? wrapForReactDoctor("displayName", settings) : null;
};

const jsxNoUselessFragmentTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxNoUselessFragment", passthroughTopLevelObject(fixture.oxcOptions));

const jsxPascalCaseTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxPascalCase", passthroughTopLevelObject(fixture.oxcOptions));

const jsxMaxDepthTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxMaxDepth", passthroughTopLevelObject(fixture.oxcOptions));

const checkedRequiresTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor(
    "checkedRequiresOnchangeOrReadonly",
    passthroughTopLevelObject(fixture.oxcOptions),
  );

const stylePropObjectTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("stylePropObject", passthroughTopLevelObject(fixture.oxcOptions));

const hookUseStateTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("hookUseState", passthroughTopLevelObject(fixture.oxcOptions));

// `[<enum-string> | { mode: <enum-string> }]` → `{ mode }`
const enumModeTranslator =
  (settingsKey: string) =>
  (fixture: OxcFixtureLike): Record<string, unknown> | null => {
    if (!Array.isArray(fixture.oxcOptions) || fixture.oxcOptions.length === 0) return null;
    const first = fixture.oxcOptions[0];
    if (typeof first === "string") return wrapForReactDoctor(settingsKey, { mode: first });
    if (typeof first === "object" && first !== null && "mode" in first) {
      return wrapForReactDoctor(settingsKey, {
        mode: (first as { mode: string }).mode,
      });
    }
    return null;
  };

const jsxBooleanValueTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  if (!Array.isArray(fixture.oxcOptions) || fixture.oxcOptions.length === 0) return null;
  const merged: Record<string, unknown> = {};
  const first = fixture.oxcOptions[0];
  if (typeof first === "string") merged.mode = first;
  const second = fixture.oxcOptions[1];
  if (typeof second === "object" && second !== null) Object.assign(merged, second);
  return wrapForReactDoctor("jsxBooleanValue", merged);
};

const stringNoUnsafeTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  const result: Record<string, unknown> = {};
  const reactDoctor = wrapForReactDoctor("noUnsafe", passthroughTopLevelObject(fixture.oxcOptions));
  if (reactDoctor) Object.assign(result, reactDoctor);
  // Forward `oxcSettings.settings.react` through so the rule's
  // version-gating logic can see the fixture's React version.
  const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
  if (reactBlock) result.react = reactBlock;
  return Object.keys(result).length > 0 ? result : null;
};

// forbid-elements: OXC payload is `[{ "forbid": [string | { element, message? }] }]`
// → react-doctor `{ forbidElements: { forbid: [...] } }`
const forbidElementsTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("forbidElements", passthroughTopLevelObject(fixture.oxcOptions));

// forbid-dom-props: same shape with `propName` keys
const forbidDomPropsTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("forbidDomProps", passthroughTopLevelObject(fixture.oxcOptions));

const jsxPropsNoSpreadingTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxPropsNoSpreading", passthroughTopLevelObject(fixture.oxcOptions));

const jsxFragmentsTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  if (!Array.isArray(fixture.oxcOptions) || fixture.oxcOptions.length === 0) return null;
  const first = fixture.oxcOptions[0];
  if (typeof first === "string") return wrapForReactDoctor("jsxFragments", { mode: first });
  if (typeof first === "object" && first !== null && "mode" in first) {
    return wrapForReactDoctor("jsxFragments", {
      mode: (first as { mode: string }).mode,
    });
  }
  return null;
};

const jsxFilenameExtensionTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("jsxFilenameExtension", passthroughTopLevelObject(fixture.oxcOptions));

// noStringRefs: `[{ noTemplateLiterals: true }]` — wrap directly.
const noStringRefsTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("noStringRefs", passthroughTopLevelObject(fixture.oxcOptions));

const noDidMountSetStateTranslator = enumModeTranslator("noDidMountSetState");
const noDidUpdateSetStateTranslator = enumModeTranslator("noDidUpdateSetState");
// no-will-update-set-state additionally honors `react.version` so we
// forward the OXC settings.react block through verbatim.
const noWillUpdateSetStateTranslator = (
  fixture: OxcFixtureLike,
): Record<string, unknown> | null => {
  const result: Record<string, unknown> = {};
  const enumed = enumModeTranslator("noWillUpdateSetState")(fixture);
  if (enumed) Object.assign(result, enumed);
  const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
  if (reactBlock) result.react = reactBlock;
  return Object.keys(result).length > 0 ? result : null;
};

const stateInConstructorTranslator = enumModeTranslator("stateInConstructor");
const preferEs6ClassTranslator = enumModeTranslator("preferEs6Class");

const selfClosingCompTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null =>
  wrapForReactDoctor("selfClosingComp", passthroughTopLevelObject(fixture.oxcOptions));

// no-this-in-sfc honors `settings.react.createClass` to extend the set
// of class-component factories — forward it through.
const noThisInSfcTranslator = (fixture: OxcFixtureLike): Record<string, unknown> | null => {
  const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
  return reactBlock ? { react: reactBlock } : null;
};

export const TRANSLATORS: Record<
  string,
  (fixture: OxcFixtureLike) => Record<string, unknown> | null
> = {
  "button-has-type": buttonHasTypeTranslator,
  "checked-requires-onchange-or-readonly": checkedRequiresTranslator,
  "forbid-dom-props": forbidDomPropsTranslator,
  "forbid-elements": forbidElementsTranslator,
  "hook-use-state": hookUseStateTranslator,
  "jsx-boolean-value": jsxBooleanValueTranslator,
  "jsx-filename-extension": jsxFilenameExtensionTranslator,
  "jsx-fragments": jsxFragmentsTranslator,
  "jsx-key": jsxKeyTranslator,
  "rules-of-hooks": rulesOfHooksTranslator,
  "jsx-max-depth": jsxMaxDepthTranslator,
  "jsx-no-script-url": jsxNoScriptUrlTranslator,
  "jsx-no-useless-fragment": jsxNoUselessFragmentTranslator,
  "jsx-pascal-case": jsxPascalCaseTranslator,
  "jsx-props-no-spreading": jsxPropsNoSpreadingTranslator,
  "no-did-mount-set-state": noDidMountSetStateTranslator,
  "no-did-update-set-state": noDidUpdateSetStateTranslator,
  "no-string-refs": noStringRefsTranslator,
  "no-this-in-sfc": noThisInSfcTranslator,
  "no-multi-comp": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("noMultiComp", passthroughTopLevelObject(fixture.oxcOptions)),
  "jsx-no-target-blank": (fixture: OxcFixtureLike) => {
    const result: Record<string, unknown> = {};
    const reactDoctor = wrapForReactDoctor(
      "jsxNoTargetBlank",
      passthroughTopLevelObject(fixture.oxcOptions),
    );
    if (reactDoctor) Object.assign(result, reactDoctor);
    const reactBlock = oxcSettingsReactBlock(fixture.oxcSettings);
    if (reactBlock) result.react = reactBlock;
    return Object.keys(result).length > 0 ? result : null;
  },
  "prefer-function-component": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("preferFunctionComponent", passthroughTopLevelObject(fixture.oxcOptions)),
  "display-name": displayNameTranslator,
  "no-unstable-nested-components": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("noUnstableNestedComponents", passthroughTopLevelObject(fixture.oxcOptions)),
  "only-export-components": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("onlyExportComponents", passthroughTopLevelObject(fixture.oxcOptions)),
  "jsx-handler-names": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("jsxHandlerNames", passthroughTopLevelObject(fixture.oxcOptions)),
  "jsx-curly-brace-presence": (fixture: OxcFixtureLike) => {
    if (!Array.isArray(fixture.oxcOptions) || fixture.oxcOptions.length === 0) return null;
    const first = fixture.oxcOptions[0];
    if (typeof first === "string")
      return wrapForReactDoctor("jsxCurlyBracePresence", { props: first, children: first });
    return wrapForReactDoctor("jsxCurlyBracePresence", first as Record<string, unknown>);
  },
  "exhaustive-deps": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("exhaustiveDeps", passthroughTopLevelObject(fixture.oxcOptions)),
  "forbid-component-props": (fixture: OxcFixtureLike) =>
    wrapForReactDoctor("forbidComponentProps", passthroughTopLevelObject(fixture.oxcOptions)),
  "no-unknown-property": noUnknownPropertyTranslator,
  "no-unsafe": stringNoUnsafeTranslator,
  "no-will-update-set-state": noWillUpdateSetStateTranslator,
  "prefer-es6-class": preferEs6ClassTranslator,
  "self-closing-comp": selfClosingCompTranslator,
  "state-in-constructor": stateInConstructorTranslator,
  "style-prop-object": stylePropObjectTranslator,
};
