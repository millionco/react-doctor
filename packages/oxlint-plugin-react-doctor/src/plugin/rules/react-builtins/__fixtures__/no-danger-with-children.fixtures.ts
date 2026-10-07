// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_danger_with_children.rs`
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
  { code: `<div>Children</div>` },
  { code: `<div {...props} />` },
  { code: `<div dangerouslySetInnerHTML={{ __html: "HTML" }} />` },
  { code: `<div children="Children" />` },
  {
    code: `
        const props = { dangerouslySetInnerHTML: { __html: "HTML" } };
        <div {...props} />
        `,
  },
  {
    code: `
        const moreProps = { className: "eslint" };
        const props = { children: "Children", ...moreProps };
        <div {...props} />
        `,
  },
  {
    code: `
        const otherProps = { children: "Children" };
        const { a, b, ...props } = otherProps;
        <div {...props} />
        `,
  },
  { code: `<Hello>Children</Hello>` },
  { code: `<Hello dangerouslySetInnerHTML={{ __html: "HTML" }} />` },
  {
    code: `
        <Hello dangerouslySetInnerHTML={{ __html: "HTML" }}>
        </Hello>
        `,
  },
  { code: `React.createElement("div", { dangerouslySetInnerHTML: { __html: "HTML" } });` },
  { code: `React.createElement("div", {}, "Children");` },
  { code: `React.createElement("Hello", { dangerouslySetInnerHTML: { __html: "HTML" } });` },
  { code: `React.createElement("Hello", {}, "Children");` },
  { code: `<Hello {...undefined}>Children</Hello>` },
  { code: `React.createElement("Hello", undefined, "Children")` },
  {
    code: `
        const props = {...props, scratch: {mode: 'edit'}};
        const component = shallow(<TaskEditableTitle {...props} />);
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
        <div dangerouslySetInnerHTML={{ __html: "HTML" }}>
            Children
        </div>
        `,
  },
  { code: `<div dangerouslySetInnerHTML={{ __html: "HTML" }} children="Children" />` },
  {
    code: `
        const props = { dangerouslySetInnerHTML: { __html: "HTML" } };
        <div {...props}>Children</div>
        `,
  },
  {
    code: `
        const props = { children: "Children", dangerouslySetInnerHTML: { __html: "HTML" } };
        <div {...props} />
        `,
  },
  {
    code: `
        <Hello dangerouslySetInnerHTML={{ __html: "HTML" }}>
            Children
        </Hello>
        `,
  },
  { code: `<Hello dangerouslySetInnerHTML={{ __html: "HTML" }} children="Children" />` },
  { code: `<Hello dangerouslySetInnerHTML={{ __html: "HTML" }}> </Hello>` },
  {
    code: `
        React.createElement(
            "div",
            { dangerouslySetInnerHTML: { __html: "HTML" } },
            "Children"
        );
        `,
  },
  {
    code: `
        React.createElement(
            "div",
            {
                dangerouslySetInnerHTML: { __html: "HTML" },
                children: "Children",
            }
        );
        `,
  },
  {
    code: `
        React.createElement(
            "Hello",
            { dangerouslySetInnerHTML: { __html: "HTML" } },
            "Children"
        );
        `,
  },
  {
    code: `
        React.createElement(
            "Hello",
            {
                dangerouslySetInnerHTML: { __html: "HTML" },
                children: "Children",
            }
        );
        `,
  },
  {
    code: `
        const props = { dangerouslySetInnerHTML: { __html: "HTML" } };
        React.createElement("div", props, "Children");
        `,
  },
  {
    code: `
        const props = { children: "Children", dangerouslySetInnerHTML: { __html: "HTML" } };
        React.createElement("div", props);
        `,
  },
  {
    code: `
        const moreProps = { children: "Children" };
        const otherProps = { ...moreProps };
        const props = { ...otherProps, dangerouslySetInnerHTML: { __html: "HTML" } };
        React.createElement("div", props);
        `,
  },
];
