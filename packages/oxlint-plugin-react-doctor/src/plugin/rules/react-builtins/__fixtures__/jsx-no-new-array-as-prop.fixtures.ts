// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react_perf/jsx_no_new_array_as_prop.rs`
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
  { code: `<Item list={this.props.list} />` },
  { code: `<Item list={[]} />` },
  { code: `<Item list={new Array()} />` },
  { code: `<Item list={Array()} />` },
  { code: `<Item list={this.props.list || []} />` },
  { code: `<Item list={this.props.list ? this.props.list : []} />` },
  { code: `<Item list={this.props.list || (this.props.arr ? this.props.arr : [])} />` },
  { code: `const Foo = () => <Item list={this.props.list} />` },
  { code: `const x = []; const Foo = () => <Item list={x} />` },
  { code: `const DEFAULT_X = []; const Foo = ({ x = DEFAULT_X }) => <Item list={x} />` },
  { code: `const Foo = () => <div list={[]} />`, oxcOptions: [{ nativeAllowList: "all" }] },
  { code: `const Foo = () => <div list={[]} />`, oxcOptions: [{ nativeAllowList: ["list"] }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `const Foo = () => (<Item list={[]} />)` },
  { code: `const Foo = () => (<Item list={new Array()} />)` },
  { code: `const Foo = () => (<Item list={Array()} />)` },
  { code: `const Foo = () => (<Item list={arr1.concat(arr2)} />)` },
  { code: `const Foo = () => (<Item list={arr1.filter(x => x > 0)} />)` },
  { code: `const Foo = () => (<Item list={arr1.map(x => x * x)} />)` },
  { code: `const Foo = () => (<Item list={this.props.list || []} />)` },
  { code: `const Foo = () => (<Item list={this.props.list ? this.props.list : []} />)` },
  {
    code: `const Foo = () => (<Item list={this.props.list || (this.props.arr ? this.props.arr : [])} />)`,
  },
  { code: `const Foo = () => { let x = []; return <Item list={x} /> }` },
  { code: `const Foo = ({ x = [] }) => <Item list={x} />` },
  { code: `const Foo = () => <div list={[]} />`, oxcOptions: [{ nativeAllowList: ["style"] }] },
];
