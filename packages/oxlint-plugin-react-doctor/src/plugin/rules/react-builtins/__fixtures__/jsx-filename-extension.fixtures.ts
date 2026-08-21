// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_filename_extension.rs`
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
  {
    code: `module.exports = function MyComponent() { return <div>jsx
<div />
</div>; }`,
    oxcFilename: "foo.jsx",
  },
  { code: `export default function MyComponent() { return <Comp />; }`, oxcFilename: "foo.jsx" },
  { code: `export function MyComponent() { return <div><Comp /></div>; }`, oxcFilename: "foo.jsx" },
  {
    code: `const MyComponent = () => (<div><Comp /></div>); export default MyComponent;`,
    oxcFilename: "foo.jsx",
  },
  {
    code: `export function MyComponent() { return <div><Comp /></div>; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <div>jsx
<div />
</div>; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcFilename: "foo.jsx",
  },
  {
    code: `export function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcFilename: "foo.jsx",
  },
  {
    code: `export function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.jsx",
  },
  { code: `module.exports = {}`, oxcFilename: "foo.js" },
  { code: `export const foo = () => 'foo';`, oxcFilename: "foo.js" },
  { code: `module.exports = {}`, oxcOptions: [{ allow: "as-needed" }], oxcFilename: "foo.js" },
  { code: `module.exports = {}`, oxcFilename: "foo.jsx" },
  {
    code: `module.exports = function MyComponent() { return <div>jsx
<div />
</div>; }`,
    oxcOptions: [{ extensions: [".js", ".jsx"] }],
    oxcFilename: "foo.js",
  },
  {
    code: `export function MyComponent() { return <div><Comp /></div>; }`,
    oxcOptions: [{ extensions: [".js", ".jsx"] }],
    oxcFilename: "foo.js",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ extensions: [".js", ".jsx"] }],
    oxcFilename: "foo.js",
  },
  {
    code: `export function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ extensions: [".js", ".jsx"] }],
    oxcFilename: "foo.js",
  },
  {
    code: `//test

//comment`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.js",
  },
  {
    code: `// export function MyComponent() { return <><Comp /><Comp /></>;}
console.log('code');`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.js",
  },
  {
    code: `/* export function MyComponent() { return <><Comp /><Comp /></>;} */
console.log('code');`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.js",
  },
  {
    code: `//test

//comment`,
    oxcOptions: [{ allow: "as-needed", ignoreFilesWithoutCode: true }],
    oxcFilename: "foo.jsx",
  },
  {
    code: ``,
    oxcOptions: [{ allow: "as-needed", ignoreFilesWithoutCode: true }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `export default function MyComponent() { return <Comp />; }`,
    oxcOptions: [{ extensions: ["tsx"] }],
    oxcFilename: "foo.tsx",
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `module.exports = function MyComponent() { return <div>
<div />
</div>; }`,
    oxcFilename: "foo.js",
  },
  { code: `export default function MyComponent() { return <Comp />; }`, oxcFilename: "foo.js" },
  { code: `export function MyComponent() { return <div><Comp /></div>; }`, oxcFilename: "foo.js" },
  {
    code: `const MyComponent = () => (<div><Comp /></div>); export default MyComponent;`,
    oxcFilename: "foo.js",
  },
  { code: `module.exports = {}`, oxcOptions: [{ allow: "as-needed" }], oxcFilename: "foo.jsx" },
  {
    code: `export function foo() { return 'foo'; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <div>
<div />
</div>; }`,
    oxcOptions: [{ allow: "as-needed" }],
    oxcFilename: "foo.js",
  },
  {
    code: `module.exports = function MyComponent() { return <div>
<div />
</div>; }`,
    oxcOptions: [{ extensions: [".js"] }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `export function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcFilename: "foo.js",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcFilename: "foo.js",
  },
  {
    code: `export function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ extensions: [".js"] }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ extensions: [".js"] }],
    oxcFilename: "foo.jsx",
  },
  {
    code: `module.exports = function MyComponent() { return <><Comp /><Comp /></>; }`,
    oxcOptions: [{ extensions: ["js", "js"] }],
    oxcFilename: "foo.jsx",
  },
];
