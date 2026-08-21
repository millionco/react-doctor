// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/no_distracting_elements.rs`
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
  { code: `<Marquee />` },
  { code: `<div marquee />` },
  { code: `<Blink />` },
  { code: `<div blink />` },
  { code: `<marquee />`, oxcOptions: [{ elements: [] }] },
  { code: `<blink />`, oxcOptions: [{ elements: ["marquee"] }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<marquee />` },
  { code: `<marquee {...props} />` },
  { code: `<marquee lang={undefined} />` },
  { code: `<blink />` },
  { code: `<blink {...props} />` },
  { code: `<blink foo={undefined} />` },
  { code: `<marquee />`, oxcOptions: [{ elements: ["marquee"] }] },
  { code: `<blink />`, oxcOptions: [{ elements: ["blink"] }] },
  {
    code: `<Blink />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Blink: "blink",
            Marquee: "marquee",
          },
        },
      },
    },
  },
  {
    code: `<Marquee />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Blink: "blink",
            Marquee: "marquee",
          },
        },
      },
    },
  },
];
