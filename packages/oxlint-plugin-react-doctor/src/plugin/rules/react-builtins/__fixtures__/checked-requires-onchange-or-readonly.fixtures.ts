// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/checked_requires_onchange_or_readonly.rs`
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
  { code: `<input type='checkbox' />` },
  { code: `<input type='checkbox' onChange={noop} />` },
  { code: `<input type='checkbox' readOnly />` },
  { code: `<input type='checkbox' checked onChange={noop} />` },
  { code: `<input type='checkbox' checked={true} onChange={noop} />` },
  { code: `<input type='checkbox' checked={false} onChange={noop} />` },
  { code: `<input type='checkbox' checked readOnly />` },
  { code: `<input type='checkbox' checked={true} readOnly />` },
  { code: `<input type='checkbox' checked={false} readOnly />` },
  { code: `<input type='checkbox' defaultChecked />` },
  { code: `React.createElement('input')` },
  { code: `React.createElement('input', { checked: true, onChange: noop })` },
  { code: `React.createElement('input', { checked: false, onChange: noop })` },
  { code: `React.createElement('input', { checked: true, readOnly: true })` },
  { code: `React.createElement('input', { checked: true, onChange: noop, readOnly: true })` },
  { code: `React.createElement('input', { checked: foo, onChange: noop, readOnly: true })` },
  { code: `<input type='checkbox' checked />`, oxcOptions: [{ ignoreMissingProperties: true }] },
  {
    code: `<input type='checkbox' checked={true} />`,
    oxcOptions: [{ ignoreMissingProperties: true }],
  },
  {
    code: `<input type='checkbox' onChange={noop} checked defaultChecked />`,
    oxcOptions: [{ ignoreExclusiveCheckedAttribute: true }],
  },
  {
    code: `<input type='checkbox' onChange={noop} checked={true} defaultChecked />`,
    oxcOptions: [{ ignoreExclusiveCheckedAttribute: true }],
  },
  {
    code: `<input type='checkbox' onChange={noop} checked defaultChecked />`,
    oxcOptions: [{ ignoreMissingProperties: true, ignoreExclusiveCheckedAttribute: true }],
  },
  { code: `<span/>` },
  { code: `React.createElement('span')` },
  { code: `(()=>{})()` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<input type='radio' checked />` },
  { code: `<input type='radio' checked={true} />` },
  { code: `<input type='checkbox' checked />` },
  { code: `<input type='checkbox' checked={true} />` },
  { code: `<input type='checkbox' checked={condition ? true : false} />` },
  { code: `<input type='checkbox' checked defaultChecked />` },
  { code: `React.createElement('input', { checked: false })` },
  { code: `React.createElement('input', { checked: true, defaultChecked: true })` },
  {
    code: `<input type='checkbox' checked defaultChecked />`,
    oxcOptions: [{ ignoreMissingProperties: true }],
  },
  {
    code: `<input type='checkbox' checked defaultChecked />`,
    oxcOptions: [{ ignoreExclusiveCheckedAttribute: true }],
  },
  {
    code: `<input type='checkbox' checked defaultChecked />`,
    oxcOptions: [{ ignoreMissingProperties: false, ignoreExclusiveCheckedAttribute: false }],
  },
];
