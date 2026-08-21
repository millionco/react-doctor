// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/role_has_required_aria_props.rs`
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
  { code: `<Bar baz />` },
  { code: `<div />` },
  { code: `<div></div>` },
  { code: `<div role={role} />` },
  { code: `<div role={role || 'button'} />` },
  { code: `<div role={role || 'foobar'} />` },
  { code: `<div role='row' />` },
  { code: `<span role='checkbox' aria-checked='false' aria-labelledby='foo' tabindex='0'></span>` },
  {
    code: `<input role='checkbox' aria-checked='false' aria-labelledby='foo' tabindex='0' {...props} type='checkbox' />`,
  },
  {
    code: `<MyComponent role='checkbox' aria-checked='false' aria-labelledby='foo' tabindex='0' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            MyComponent: "div",
          },
        },
      },
    },
  },
  { code: `<div role='menuitemradio' aria-checked='false' />` },
  { code: `<div role='menuitemcheckbox' aria-checked='false' />` },
  { code: `<div role='tab' />` },
  { code: `<div role='meter' aria-valuenow='0' />` },
  { code: `<div role='switch' aria-checked='false' />` },
  { code: `<div role='scrollbar' aria-controls='foo' aria-valuenow='0' />` },
  { code: `<div role='slider' aria-valuenow='0' />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div role='slider' />` },
  { code: `<div role='slider' aria-valuemax />` },
  { code: `<div role='slider' aria-valuemax aria-valuemin />` },
  { code: `<div role='checkbox' />` },
  { code: `<div role='checkbox' checked />` },
  { code: `<div role='checkbox' aria-chcked />` },
  { code: `<div role='combobox' />` },
  { code: `<div role='combobox' expanded />` },
  { code: `<div role='combobox' aria-expandd />` },
  { code: `<div role='scrollbar' />` },
  { code: `<div role='scrollbar' aria-controls='foo' />` },
  { code: `<div role='scrollbar' aria-valuenow='0' />` },
  { code: `<div role='meter' />` },
  { code: `<div role='switch' />` },
  { code: `<input type='checkbox' role='switch' />` },
  { code: `<div role='heading' />` },
  { code: `<div role='option' />` },
  { code: `<div role='menuitemradio' />` },
  { code: `<div role='menuitemcheckbox' />` },
  {
    code: `<MyComponent role='combobox' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            MyComponent: "div",
          },
        },
      },
    },
  },
];
