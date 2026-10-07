// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/aria_activedescendant_has_tabindex.rs`
// Each entry is a verbatim port of an OXC `pass`/`fail` vec entry.
// `oxcOptions` (optional) is OXC's first config arg (`Some(json!([…]))`),
// preserved as JS for tests that want to translate it. `oxcSettings`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
  { code: `<CustomComponent />;` },
  { code: `<CustomComponent aria-activedescendant={someID} />;` },
  { code: `<CustomComponent aria-activedescendant={someID} tabIndex={0} />;` },
  { code: `<CustomComponent aria-activedescendant={someID} tabIndex={-1} />;` },
  {
    code: `<CustomComponent aria-activedescendant={someID} tabIndex={0} />;`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomComponent: "div",
          },
        },
      },
    },
  },
  { code: `<div />;` },
  { code: `<input />;` },
  { code: `<div tabIndex={0} />;` },
  { code: `<div aria-activedescendant={someID} tabIndex={0} />;` },
  { code: `<div aria-activedescendant={someID} tabIndex='0' />;` },
  { code: `<div aria-activedescendant={someID} tabIndex={1} />;` },
  { code: `<input aria-activedescendant={someID} />;` },
  { code: `<input aria-activedescendant={someID} tabIndex={1} />;` },
  { code: `<input aria-activedescendant={someID} tabIndex={0} />;` },
  { code: `<input aria-activedescendant={someID} tabIndex={-1} />;` },
  { code: `<div aria-activedescendant={someID} tabIndex={-1} />;` },
  { code: `<div aria-activedescendant={someID} tabIndex='-1' />;` },
  { code: `<input aria-activedescendant={someID} tabIndex={-1} />;` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div aria-activedescendant={someID} />;` },
  {
    code: `<CustomComponent aria-activedescendant={someID} />;`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomComponent: "div",
          },
        },
      },
    },
  },
];
