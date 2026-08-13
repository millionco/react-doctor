// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/forbid_elements.rs`
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
  { code: `<button />`, oxcOptions: [] },
  { code: `<button />`, oxcOptions: [{ forbid: [] }] },
  { code: `<Button />`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `<Button />`, oxcOptions: [{ forbid: [{ element: "button" }] }] },
  { code: `React.createElement(button)`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `NotReact.createElement("button")`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `React.createElement("_thing")`, oxcOptions: [{ forbid: ["_thing"] }] },
  { code: `React.createElement("Modal")`, oxcOptions: [{ forbid: ["Modal"] }] },
  {
    code: `React.createElement("dotted.component")`,
    oxcOptions: [{ forbid: ["dotted.component"] }],
  },
  { code: `React.createElement(function() {})`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `React.createElement({})`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `React.createElement(1)`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `React.createElement()` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<button />`, oxcOptions: [{ forbid: ["button"] }] },
  { code: `[<Modal />, <button />]`, oxcOptions: [{ forbid: ["button", "Modal"] }] },
  { code: `<dotted.component />`, oxcOptions: [{ forbid: ["dotted.component"] }] },
  {
    code: `<dotted.Component />`,
    oxcOptions: [{ forbid: [{ element: "dotted.Component", message: 'that ain"t cool' }] }],
  },
  {
    code: `<button />`,
    oxcOptions: [{ forbid: [{ element: "button", message: "use <Button> instead" }] }],
  },
  {
    code: `<button><input /></button>`,
    oxcOptions: [{ forbid: [{ element: "button" }, { element: "input" }] }],
  },
  {
    code: `<button><input /></button>`,
    oxcOptions: [{ forbid: [{ element: "button" }, "input"] }],
  },
  {
    code: `<button><input /></button>`,
    oxcOptions: [{ forbid: ["input", { element: "button" }] }],
  },
  {
    code: `<button />`,
    oxcOptions: [
      {
        forbid: [
          { element: "button", message: "use <Button> instead" },
          { element: "button", message: "use <Button2> instead" },
        ],
      },
    ],
  },
  { code: `React.createElement("button", {}, child)`, oxcOptions: [{ forbid: ["button"] }] },
  {
    code: `[React.createElement(Modal), React.createElement("button")]`,
    oxcOptions: [{ forbid: ["button", "Modal"] }],
  },
  {
    code: `React.createElement(dotted.Component)`,
    oxcOptions: [{ forbid: [{ element: "dotted.Component", message: 'that ain"t cool' }] }],
  },
  { code: `React.createElement(dotted.component)`, oxcOptions: [{ forbid: ["dotted.component"] }] },
  { code: `React.createElement(_comp)`, oxcOptions: [{ forbid: ["_comp"] }] },
  {
    code: `React.createElement("button")`,
    oxcOptions: [{ forbid: [{ element: "button", message: "use <Button> instead" }] }],
  },
  {
    code: `React.createElement("button", {}, React.createElement("input"))`,
    oxcOptions: [{ forbid: [{ element: "button" }, { element: "input" }] }],
  },
];
