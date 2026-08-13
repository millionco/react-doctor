// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/autocomplete_valid.rs`
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
  { code: `<input type='text' />;` },
  { code: `<input type='text' autocomplete='name' />;` },
  { code: `<input type='text' autocomplete='on' />;` },
  { code: `<input type='text' autocomplete={autocompl} />;` },
  { code: `<input type='text' autocomplete={autocompl || 'name'} />;` },
  { code: `<input type='text' autocomplete={autocompl || 'foo'} />;` },
  { code: `<Foo autocomplete='bar'></Foo>;` },
  { code: `<Input type='text' autocomplete='baz' />` },
  { code: `<input type='date' autocomplete='email' />;` },
  { code: `<input type='number' autocomplete='url' />;` },
  { code: `<input type='month' autocomplete='tel' />;` },
  {
    code: `<Foo type='month' autocomplete='tel'></Foo>;`,
    oxcOptions: [{ inputComponents: ["Foo"] }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<input type='text' autocomplete='foo' />;` },
  { code: `<input type='text' autocomplete='name invalid' />;` },
  { code: `<input type='text' autocomplete='invalid name' />;` },
  { code: `<input type='text' autocomplete='home url' />;` },
  { code: `<Bar autocomplete='baz'></Bar>;`, oxcOptions: [{ inputComponents: ["Bar"] }] },
  {
    code: `<Input type='text' autocomplete='baz' />;`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Input: "input",
          },
        },
      },
    },
  },
];
