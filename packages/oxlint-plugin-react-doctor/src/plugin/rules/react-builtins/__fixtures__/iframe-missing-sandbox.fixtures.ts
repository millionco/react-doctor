// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/iframe_missing_sandbox.rs`
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
  { code: `<div sandbox="__unknown__" />;` },
  { code: `<iframe sandbox="" />;` },
  { code: `<iframe sandbox={""} />` },
  { code: `React.createElement("iframe", { sandbox: "" });` },
  { code: `<iframe src="foo.htm" sandbox></iframe>` },
  { code: `React.createElement("iframe", { src: "foo.htm", sandbox: true })` },
  { code: `<iframe src="foo.htm" sandbox sandbox></iframe>` },
  { code: `<iframe sandbox="allow-forms"></iframe>` },
  { code: `<iframe sandbox="allow-modals"></iframe>` },
  { code: `<iframe sandbox="allow-orientation-lock"></iframe>` },
  { code: `<iframe sandbox="allow-pointer-lock"></iframe>` },
  { code: `<iframe sandbox="allow-popups"></iframe>` },
  { code: `<iframe sandbox="allow-popups-to-escape-sandbox"></iframe>` },
  { code: `<iframe sandbox="allow-presentation"></iframe>` },
  { code: `<iframe sandbox="allow-same-origin"></iframe>` },
  { code: `<iframe sandbox="allow-scripts"></iframe>` },
  { code: `<iframe sandbox="allow-top-navigation"></iframe>` },
  { code: `<iframe sandbox="allow-top-navigation-by-user-activation"></iframe>` },
  { code: `<iframe sandbox="allow-forms allow-modals"></iframe>` },
  {
    code: `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-same-origin allow-top-navigation"></iframe>`,
  },
  { code: `React.createElement("iframe", { sandbox: "allow-forms" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-modals" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-orientation-lock" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-pointer-lock" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-popups" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-popups-to-escape-sandbox" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-presentation" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-same-origin" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-scripts" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-top-navigation" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-top-navigation-by-user-activation" })` },
  { code: `React.createElement("iframe", { sandbox: "allow-forms allow-modals" })` },
  {
    code: `React.createElement("iframe", { sandbox: "allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-same-origin allow-top-navigation" })`,
  },
  { code: `let expandingList = document.createElement("ul", { is: "expanding-list" });` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<iframe></iframe>;` },
  { code: `<iframe/>;` },
  { code: `React.createElement("iframe");` },
  { code: `React.createElement("iframe", {});` },
  { code: `React.createElement("iframe", null);` },
  { code: `<iframe sandbox="__unknown__"></iframe>` },
  { code: `React.createElement("iframe", { sandbox: "__unknown__" })` },
  { code: `<iframe sandbox="allow-popups __unknown__"/>` },
  { code: `<iframe sandbox="__unknown__ allow-popups"/>` },
  { code: `<iframe sandbox=" allow-forms __unknown__ allow-popups __unknown__  "/>` },
  { code: `<iframe sandbox="allow-scripts allow-same-origin"></iframe>;` },
  { code: `<iframe sandbox="allow-same-origin allow-scripts"/>;` },
];
