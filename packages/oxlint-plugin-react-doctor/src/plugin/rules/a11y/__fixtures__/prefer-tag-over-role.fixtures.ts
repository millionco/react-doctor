// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/prefer_tag_over_role.rs`
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
  { code: `<div role="unknown" />` },
  { code: `<div role="also unknown" />` },
  { code: `<other />` },
  { code: `<img role="img" />` },
  { code: `<input role="checkbox" />` },
  { code: `<button role="button" />` },
  { code: `<header role="banner" />` },
  { code: `<a role="link" />` },
  { code: `<area role="link" />` },
  { code: `<h1 role="heading" />` },
  { code: `<h6 role="heading" />` },
  { code: `<tbody role="rowgroup" />` },
  { code: `<tfoot role="rowgroup" />` },
  { code: `<thead role="rowgroup" />` },
  { code: `<select role="listbox" />` },
  { code: `<section role="region" />` },
  { code: `<input role="slider" />` },
  { code: `<input role="combobox" />` },
  { code: `<input role="radio" />` },
  { code: `<input role="textbox" />` },
  { code: `<textarea role="textbox" />` },
  { code: `<article role="article" />` },
  { code: `<aside role="complementary" />` },
  { code: `<footer role="contentinfo" />` },
  { code: `<form role="form" />` },
  { code: `<hr role="separator" />` },
  { code: `<li role="listitem" />` },
  { code: `<main role="main" />` },
  { code: `<nav role="navigation" />` },
  { code: `<ol role="list" />` },
  { code: `<ul role="list" />` },
  { code: `<menu role="list" />` },
  { code: `<table role="table" />` },
  { code: `<td role="cell" />` },
  { code: `<tr role="row" />` },
  { code: `<dialog role="dialog" />` },
  { code: `<meter role="meter" />` },
  { code: `<output role="status" />` },
  { code: `<p role="paragraph" />` },
  { code: `<progress role="progressbar" />` },
  { code: `<select role="combobox" />` },
  { code: `<del role="deletion" />` },
  { code: `<s role="deletion" />` },
  { code: `<em role="emphasis" />` },
  { code: `<strong role="strong" />` },
  { code: `<dfn role="term" />` },
  { code: `<figure role="figure" />` },
  { code: `<fieldset role="group" />` },
  { code: `<details role="group" />` },
  { code: `<sub role="subscript" />` },
  { code: `<sup role="superscript" />` },
  { code: `<option role="option" />` },
  { code: `<th role="columnheader" />` },
  { code: `<input role="searchbox" />` },
  { code: `<input role="spinbutton" />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [];
