// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/no_noninteractive_tabindex.rs`
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
  { code: `<MyButton tabIndex={0} />` },
  { code: `<button />` },
  { code: `<button tabIndex="0" />` },
  { code: `<button tabIndex={0} />` },
  { code: `<div />` },
  { code: `<div tabIndex="-1" />` },
  { code: `<div role="button" tabIndex="0" />` },
  { code: `<div role="article" tabIndex="-1" />` },
  { code: `<article tabIndex="-1" />` },
  {
    code: `<Article tabIndex="-1" />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Article: "article",
            MyButton: "button",
          },
        },
      },
    },
  },
  {
    code: `<MyButton tabIndex={0} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Article: "article",
            MyButton: "button",
          },
        },
      },
    },
  },
  { code: `<div role="tabpanel" tabIndex="0" />` },
  { code: `<div role={ROLE_BUTTON} onClick={() => {}} tabIndex="0" />;` },
  { code: `<div tabIndex={someVar} />`, oxcOptions: [{ allowExpressionValues: true }] },
  { code: `<div tabIndex={-1} />`, oxcOptions: [{ allowExpressionValues: false }] },
  {
    code: `<div role={BUTTON} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ allowExpressionValues: true }],
  },
  {
    code: `<div role={isButton ? "button" : "link"} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ allowExpressionValues: true }],
  },
  {
    code: `<div role={isButton ? "button" : LINK} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ allowExpressionValues: true }],
  },
  {
    code: `<div role={isButton ? BUTTON : LINK} onClick={() => {}} tabIndex="0"/>;`,
    oxcOptions: [{ allowExpressionValues: true }],
  },
  { code: `<div role="grid" tabIndex="0" />` },
  { code: `<div role="listbox" tabIndex="0" />` },
  { code: `<div role="menu" tabIndex="0" />` },
  { code: `<div role="menubar" tabIndex="0" />` },
  { code: `<div role="radiogroup" tabIndex="0" />` },
  { code: `<div role="tablist" tabIndex="0" />` },
  { code: `<div role="tree" tabIndex="0" />` },
  { code: `<div role="treegrid" tabIndex="0" />` },
  { code: `<div role="toolbar" tabIndex="0" />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div tabIndex="0" />` },
  { code: `<div tabIndex={0} />` },
  { code: `<div role="article" tabIndex="0" />` },
  { code: `<article tabIndex={0} />` },
  {
    code: `<Article tabIndex={0} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Article: "article",
            MyButton: "button",
          },
        },
      },
    },
  },
  { code: `<article tabIndex="0" />` },
  {
    code: `<div role="tabpanel" tabIndex="0" />`,
    oxcOptions: [{ roles: [], allowExpressionValues: false }],
  },
  {
    code: `<div role={ROLE_BUTTON} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ roles: [], allowExpressionValues: false }],
  },
  {
    code: `<div role={BUTTON} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ allowExpressionValues: false }],
  },
  {
    code: `<div role={isButton ? "button" : "link"} onClick={() => {}} tabIndex="0" />;`,
    oxcOptions: [{ allowExpressionValues: false }],
  },
  { code: `<div tabIndex={someVar} />`, oxcOptions: [{ allowExpressionValues: false }] },
  { code: `<div tabIndex={props.isTabbable ? 1 : 0} />` },
  { code: `<div tabIndex={props.isTabbable ? '1' : '0'} />` },
];
