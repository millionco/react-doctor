// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_namespace.rs`
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
  { code: `<testcomponent />` },
  { code: `React.createElement("testcomponent")` },
  { code: `<testComponent />` },
  { code: `React.createElement("testComponent")` },
  { code: `<test_component />` },
  { code: `React.createElement("test_component")` },
  { code: `<TestComponent />` },
  { code: `React.createElement("TestComponent")` },
  { code: `<object.testcomponent />` },
  { code: `React.createElement("object.testcomponent")` },
  { code: `<object.testComponent />` },
  { code: `React.createElement("object.testComponent")` },
  { code: `<object.test_component />` },
  { code: `React.createElement("object.test_component")` },
  { code: `<object.TestComponent />` },
  { code: `React.createElement("object.TestComponent")` },
  { code: `<Object.testcomponent />` },
  { code: `React.createElement("Object.testcomponent")` },
  { code: `<Object.testComponent />` },
  { code: `React.createElement("Object.testComponent")` },
  { code: `<Object.test_component />` },
  { code: `React.createElement("Object.test_component")` },
  { code: `<Object.TestComponent />` },
  { code: `React.createElement("Object.TestComponent")` },
  { code: `React.createElement(null)` },
  { code: `React.createElement(true)` },
  { code: `React.createElement({})` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<ns:testcomponent />` },
  { code: `React.createElement("ns:testcomponent")` },
  { code: `<ns:testComponent />` },
  { code: `React.createElement("ns:testComponent")` },
  { code: `<ns:test_component />` },
  { code: `React.createElement("ns:test_component")` },
  { code: `<ns:TestComponent />` },
  { code: `React.createElement("ns:TestComponent")` },
  { code: `<Ns:testcomponent />` },
  { code: `React.createElement("Ns:testcomponent")` },
  { code: `<Ns:testComponent />` },
  { code: `React.createElement("Ns:testComponent")` },
  { code: `<Ns:test_component />` },
  { code: `React.createElement("Ns:test_component")` },
  { code: `<Ns:TestComponent />` },
  { code: `React.createElement("Ns:TestComponent")` },
];
