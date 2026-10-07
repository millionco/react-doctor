// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/aria_role.rs`
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
  { code: `<div />` },
  { code: `<div></div>` },
  { code: `<div role={role} />` },
  { code: `<div role={role || 'button'} />` },
  { code: `<div role={role || 'foobar'} />` },
  { code: `<div role='tabpanel row' />` },
  { code: `<div role='switch' />` },
  { code: `<div role='doc-abstract' />` },
  { code: `<div role='doc-appendix doc-bibliography' />` },
  { code: `<Bar baz />` },
  {
    code: `<img role='invalid-role' />`,
    oxcOptions: [
      {
        allowedInvalidRoles: ["invalid-role", "other-invalid-role"],
      },
    ],
  },
  {
    code: `<img role='invalid-role tabpanel' />`,
    oxcOptions: [
      {
        allowedInvalidRoles: ["invalid-role", "other-invalid-role"],
      },
    ],
  },
  {
    code: `<img role='invalid-role other-invalid-role' />`,
    oxcOptions: [
      {
        allowedInvalidRoles: ["invalid-role", "other-invalid-role"],
      },
    ],
  },
  {
    code: `<Foo role='bar' />`,
    oxcOptions: [
      {
        ignoreNonDOM: true,
      },
    ],
  },
  {
    code: `<fakeDOM role='bar' />`,
    oxcOptions: [
      {
        ignoreNonDOM: true,
      },
    ],
  },
  {
    code: `<img role='presentation' />`,
    oxcOptions: [
      {
        ignoreNonDOM: true,
      },
    ],
  },
  {
    code: `<Div role='button' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "asChild",
          components: {
            Div: "div",
          },
        },
      },
    },
  },
  {
    code: `<Box asChild='div' role='button' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "asChild",
          components: {
            Div: "div",
          },
        },
      },
    },
  },
  { code: `<svg role='graphics-document document' />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div role='foobar' />` },
  { code: `<div role='datepicker'></div>` },
  { code: `<div role='range'></div>` },
  { code: `<div role='Button'></div>` },
  { code: `<div role=''></div>` },
  { code: `<div role='tabpanel row foobar'></div>` },
  { code: `<div role='tabpanel row range'></div>` },
  { code: `<div role='doc-endnotes range'></div>` },
  { code: `<div role />` },
  {
    code: `<div role='unknown-invalid-role' />`,
    oxcOptions: [
      {
        allowedInvalidRoles: ["invalid-role", "other-invalid-role"],
      },
    ],
  },
  { code: `<div role={null}></div>` },
  { code: `<Foo role='datepicker' />` },
  { code: `<Foo role='Button' />` },
  {
    code: `<Div role='Button' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "asChild",
          components: {
            Div: "div",
          },
        },
      },
    },
  },
  {
    code: `<Div role='Button' />`,
    oxcOptions: [
      {
        ignoreNonDOM: true,
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "asChild",
          components: {
            Div: "div",
          },
        },
      },
    },
  },
  { code: `<Box asChild='div' role='Button' />` },
];
