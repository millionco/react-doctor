// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react_perf/jsx_no_jsx_as_prop.rs`
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
  { code: `<Item callback={this.props.jsx} />` },
  { code: `const Foo = () => <Item callback={this.props.jsx} />` },
  { code: `<Item jsx={<SubItem />} />` },
  { code: `<Item jsx={this.props.jsx || <SubItem />} />` },
  { code: `<Item jsx={this.props.jsx ? this.props.jsx : <SubItem />} />` },
  {
    code: `<Item jsx={this.props.jsx || (this.props.component ? this.props.component : <SubItem />)} />`,
  },
  { code: `const Icon = <svg />; const Foo = () => (<IconButton icon={Icon} />)` },
  { code: `const Foo = () => <div jsx={<SubItem />} />`, oxcOptions: [{ nativeAllowList: "all" }] },
  {
    code: `const Foo = () => <div jsx={<SubItem />} />`,
    oxcOptions: [{ nativeAllowList: ["jsx"] }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `const Foo = () => (<Item jsx={<SubItem />} />)` },
  { code: `const Foo = () => (<Item jsx={this.props.jsx || <SubItem />} />)` },
  { code: `const Foo = () => (<Item jsx={this.props.jsx ? this.props.jsx : <SubItem />} />)` },
  {
    code: `const Foo = () => (<Item jsx={this.props.jsx || (this.props.component ? this.props.component : <SubItem />)} />)`,
  },
  { code: `const Foo = () => { const Icon = <svg />; return (<IconButton icon={Icon} />) }` },
  {
    code: `const Foo = () => <div jsx={<SubItem />} />`,
    oxcOptions: [{ nativeAllowList: ["icon"] }],
  },
];
