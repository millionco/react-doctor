// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_pascal_case.rs`
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
  { code: `<testcomponent />` },
  { code: `<testComponent />` },
  { code: `<test_component />` },
  { code: `<TestComponent />` },
  { code: `<CSSTransitionGroup />` },
  { code: `<BetterThanCSS />` },
  { code: `<TestComponent><div /></TestComponent>` },
  { code: `<Test1Component />` },
  { code: `<TestComponent1 />` },
  { code: `<T3StComp0Nent />` },
  { code: `<Éurströmming />` },
  { code: `<Año />` },
  { code: `<Søknad />` },
  { code: `<T />` },
  { code: `<YMCA />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<TEST_COMPONENT />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<Modal.Header />` },
  { code: `<qualification.T3StComp0Nent />` },
  { code: `<Modal:Header />` },
  { code: `<IGNORED />`, oxcOptions: [{ ignore: ["IGNORED"] }] },
  { code: `<Foo_DEPRECATED />`, oxcOptions: [{ ignore: ["*_DEPRECATED"] }] },
  { code: `<Foo_DEPRECATED />`, oxcOptions: [{ ignore: ["*_*[DEPRECATED,IGNORED]"] }] },
  { code: `<$ />` },
  { code: `<_ />` },
  { code: `<H1>Hello!</H1>` },
  { code: `<Typography.P />` },
  { code: `<Styled.h1 />`, oxcOptions: [{ allowNamespace: true }] },
  { code: `<Styled.H1.H2 />` },
  {
    code: `<_TEST_COMPONENT />`,
    oxcOptions: [{ allowAllCaps: true, allowLeadingUnderscore: true }],
  },
  { code: `<_TestComponent />`, oxcOptions: [{ allowLeadingUnderscore: true }] },
  { code: `<Component_ />`, oxcOptions: [{ ignore: ["Component_"] }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<Test_component />` },
  { code: `<TEST_COMPONENT />` },
  { code: `<YMCA />` },
  { code: `<_TEST_COMPONENT />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<TEST_COMPONENT_ />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<TEST-COMPONENT />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<__ />`, oxcOptions: [{ allowAllCaps: true }] },
  { code: `<_div />`, oxcOptions: [{ allowLeadingUnderscore: true }] },
  { code: `<__ />`, oxcOptions: [{ allowAllCaps: true, allowLeadingUnderscore: true }] },
  { code: `<$a />` },
  { code: `<Foo_DEPRECATED />`, oxcOptions: [{ ignore: ["*_FOO"] }] },
  { code: `<Styled.h1 />` },
  { code: `<Styled.H1.h2 />` },
  { code: `<Styled.h1.H2 />` },
  { code: `<$Typography.P />` },
  { code: `<STYLED.h1 />`, oxcOptions: [{ allowNamespace: true }] },
  { code: `<_camelCase />`, oxcOptions: [{ allowLeadingUnderscore: true }] },
  { code: `<_Test_Component />`, oxcOptions: [{ allowLeadingUnderscore: true }] },
];
