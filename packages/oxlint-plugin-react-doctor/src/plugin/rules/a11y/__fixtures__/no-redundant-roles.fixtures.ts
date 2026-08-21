// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/no_redundant_roles.rs`
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
  { code: `<button />` },
  { code: `<button></button>` },
  { code: `<button>Foo</button>` },
  { code: `<button>role</button>` },
  { code: `<nav />` },
  { code: `<main />` },
  { code: `<button role='main' />` },
  { code: `<MyComponent role='button' />` },
  { code: `<button role={\`\${foo}button\`} />` },
  {
    code: `<Button role={\`\${foo}button\`} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Button: "button",
          },
        },
      },
    },
  },
  { code: `<select role="menu"><option>1</option><option>2</option></select>` },
  { code: `<select role="menu" size={2}><option>1</option><option>2</option></select>` },
  { code: `<select role="menu" multiple><option>1</option><option>2</option></select>` },
  { code: `<select role="listbox" />` },
  { code: `<img alt="" role="img" />` },
  { code: `<ol role="list" />`, oxcOptions: [{ ul: ["list"], ol: ["list"] }] },
  { code: `<dl role="list" />`, oxcOptions: [{ ul: ["list"], ol: ["list"] }] },
  { code: `<img src="example.svg" role="img" />`, oxcOptions: [{ ul: ["list"], ol: ["list"] }] },
  { code: `<svg role="img" />`, oxcOptions: [{ ul: ["list"], ol: ["list"] }] },
  { code: `<li role="listitem" />`, oxcOptions: [{ li: ["listitem"] }] },
  { code: `<header role="banner" aria-label="Editor topbar">Topbar</header>` },
  { code: `<footer role="contentinfo" />` },
  { code: `<main role="main" />` },
  { code: `<main role="main"><p>Content</p></main>` },
  { code: `<address role="group" />` },
  { code: `<input type="text" role="combobox" />` },
  { code: `<input type="search" role="combobox" />` },
  { code: `<input type="checkbox" role="textbox" />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<body role="DOCUMENT" />` },
  { code: `<button role='button' />` },
  { code: `<button role='button' data-foo='bar' />` },
  { code: `<button role='button' data-role='bar' />` },
  { code: `<button data-role='bar' role='button' />` },
  { code: `<button role='button'></button>` },
  { code: `<button role='button'>Foo</button>` },
  { code: `<button role='button'><p>Test</p></button>` },
  { code: `<button role='button' title='button'></button>` },
  {
    code: `<Button role='button' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Button: "button",
          },
        },
      },
    },
  },
  { code: `<article role="article" />` },
  { code: `<aside role="complementary" />` },
  { code: `<form role="form" />` },
  { code: `<h1 role="heading" />` },
  { code: `<h2 role="heading" />` },
  { code: `<hr role="separator" />` },
  { code: `<img role="img" />` },
  { code: `<li role="listitem" />` },
  { code: `<ol role="list" />` },
  { code: `<ul role="list" />` },
  { code: `<select role="combobox" />` },
  { code: `<select role="combobox" size="" />` },
  { code: `<select role="combobox" size={1} />` },
  { code: `<select role="combobox" size="1" />` },
  { code: `<select role="combobox" size={null}></select>` },
  { code: `<select role="combobox" size={undefined}></select>` },
  { code: `<select role="combobox" multiple={undefined}></select>` },
  { code: `<select role="combobox" multiple={false}></select>` },
  { code: `<select role="combobox" multiple=""></select>` },
  { code: `<select role="listbox" size="3" />` },
  { code: `<select role="listbox" size={2} />` },
  { code: `<select role="listbox" multiple><option>1</option><option>2</option></select>` },
  { code: `<select role="listbox" multiple={true}></select>` },
  { code: `<table role="table" />` },
  { code: `<tbody role="rowgroup" />` },
  { code: `<td role="cell" />` },
  { code: `<textarea role="textbox" />` },
  { code: `<section role="region" />` },
  { code: `<dialog role="dialog" />` },
  { code: `<fieldset role="group" />` },
  { code: `<figure role="figure" />` },
  { code: `<meter role="meter" />` },
  { code: `<output role="status" />` },
  { code: `<p role="paragraph" />` },
  { code: `<progress role="progressbar" />` },
  { code: `<tr role="row" />` },
  { code: `<input type="search" list="opts" role="combobox" />` },
  { code: `<input type="checkbox" role="checkbox" />` },
  { code: `<input type={"checkbox"} role="checkbox" />` },
  { code: `<input type="radio" role="radio" />` },
  { code: `<input type="range" role="slider" />` },
  { code: `<input type="number" role="spinbutton" />` },
  { code: `<input type="search" role="searchbox" />` },
  { code: `<input type="text" role="textbox" />` },
  { code: `<input role="textbox" />` },
  { code: `<input type="email" list="opts" role="combobox" />` },
  { code: `<input type="button" role="button" />` },
  { code: `<input type="image" role="button" />` },
  { code: `<input type="reset" role="button" />` },
  { code: `<input type="submit" role="button" />` },
];
