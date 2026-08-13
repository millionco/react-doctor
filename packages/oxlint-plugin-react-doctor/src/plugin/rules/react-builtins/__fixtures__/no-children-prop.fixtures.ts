// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_children_prop.rs`
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
  { code: `<div />;` },
  { code: `<div></div>;` },
  { code: `React.createElement("div", {});` },
  { code: `React.createElement("div", undefined);` },
  { code: `<div className="class-name"></div>;` },
  { code: `React.createElement("div", {className: "class-name"});` },
  { code: `<div>Children</div>;` },
  { code: `React.createElement("div", "Children");` },
  { code: `React.createElement("div", {}, "Children");` },
  { code: `React.createElement("div", undefined, "Children");` },
  { code: `<div className="class-name">Children</div>;` },
  { code: `React.createElement("div", {className: "class-name"}, "Children");` },
  { code: `<div><div /></div>;` },
  { code: `React.createElement("div", React.createElement("div"));` },
  { code: `React.createElement("div", {}, React.createElement("div"));` },
  { code: `React.createElement("div", undefined, React.createElement("div"));` },
  { code: `<div><div /><div /></div>;` },
  { code: `React.createElement("div", React.createElement("div"), React.createElement("div"));` },
  {
    code: `React.createElement("div", {}, React.createElement("div"), React.createElement("div"));`,
  },
  {
    code: `React.createElement("div", undefined, React.createElement("div"), React.createElement("div"));`,
  },
  { code: `React.createElement("div", [React.createElement("div"), React.createElement("div")]);` },
  {
    code: `React.createElement("div", {}, [React.createElement("div"), React.createElement("div")]);`,
  },
  {
    code: `React.createElement("div", undefined, [React.createElement("div"), React.createElement("div")]);`,
  },
  { code: `<MyComponent />` },
  { code: `React.createElement(MyComponent);` },
  { code: `React.createElement(MyComponent, {});` },
  { code: `React.createElement(MyComponent, undefined);` },
  { code: `<MyComponent>Children</MyComponent>;` },
  { code: `React.createElement(MyComponent, "Children");` },
  { code: `React.createElement(MyComponent, {}, "Children");` },
  { code: `React.createElement(MyComponent, undefined, "Children");` },
  { code: `<MyComponent className="class-name"></MyComponent>;` },
  { code: `React.createElement(MyComponent, {className: "class-name"});` },
  { code: `<MyComponent className="class-name">Children</MyComponent>;` },
  { code: `React.createElement(MyComponent, {className: "class-name"}, "Children");` },
  { code: `<MyComponent className="class-name" {...props} />;` },
  { code: `foo(MyComponent, {...props, children: "Children"})` },
  { code: `React.createElement(MyComponent, {className: "class-name", ...props});` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div children />;` },
  { code: `<div children="Children" />;` },
  { code: `<div children={<div />} />;` },
  { code: `<div children={[<div />, <div />]} />;` },
  { code: `<div children="Children">Children</div>;` },
  { code: `React.createElement("div", {children: "Children"});` },
  { code: `React.createElement("div", {children: "Children"}, "Children");` },
  { code: `React.createElement("div", {children: React.createElement("div")});` },
  {
    code: `React.createElement("div", {children: [React.createElement("div"), React.createElement("div")]});`,
  },
  { code: `<MyComponent children="Children" />` },
  { code: `React.createElement(MyComponent, {children: "Children"});` },
  { code: `<MyComponent className="class-name" children="Children" />;` },
  { code: `React.createElement(MyComponent, {children: "Children", className: "class-name"});` },
  { code: `<MyComponent {...props} children="Children" />;` },
  { code: `React.createElement(MyComponent, {...props, children: "Children"})` },
];
