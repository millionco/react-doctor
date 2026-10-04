// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/click_events_have_key_events.rs`
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
  { code: `<div onClick={() => void 0} onKeyDown={foo}/>;` },
  { code: `<div onClick={() => void 0} onKeyUp={foo} />;` },
  { code: `<div onClick={() => void 0} onKeyPress={foo}/>;` },
  { code: `<div onClick={() => void 0} onKeyDown={foo} onKeyUp={bar} />;` },
  { code: `<div onClick={() => void 0} onKeyDown={foo} {...props} />;` },
  { code: `<div className="foo" />;` },
  { code: `<div onClick={() => void 0} aria-hidden />;` },
  { code: `<div onClick={() => void 0} aria-hidden={true} />;` },
  { code: `<div onClick={() => void 0} aria-hidden={false} onKeyDown={foo} />;` },
  { code: `<div onClick={() => void 0} onKeyDown={foo} aria-hidden={undefined} />;` },
  { code: `<input type="text" onClick={() => void 0} />` },
  { code: `<input onClick={() => void 0} />` },
  { code: `<button onClick={() => void 0} className="foo" />` },
  { code: `<select onClick={() => void 0} className="foo" />` },
  { code: `<textarea onClick={() => void 0} className="foo" />` },
  { code: `<a onClick={() => void 0} href="http://x.y.z" />` },
  { code: `<a onClick={() => void 0} href="http://x.y.z" tabIndex="0" />` },
  { code: `<input onClick={() => void 0} type="hidden" />;` },
  { code: `<div onClick={() => void 0} role="presentation" />;` },
  { code: `<div onClick={() => void 0} role="none" />;` },
  { code: `<TestComponent onClick={doFoo} />` },
  { code: `<Button onClick={doFoo} />` },
  { code: `<Footer onClick={doFoo} />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div onClick={() => void 0} />;` },
  { code: `<div onClick={() => void 0} role={undefined} />;` },
  { code: `<div onClick={() => void 0} {...props} />;` },
  { code: `<section onClick={() => void 0} />;` },
  { code: `<main onClick={() => void 0} />;` },
  { code: `<article onClick={() => void 0} />;` },
  { code: `<header onClick={() => void 0} />;` },
  { code: `<footer onClick={() => void 0} />;` },
  { code: `<div onClick={() => void 0} aria-hidden={false} />;` },
  { code: `<a onClick={() => void 0} />` },
  { code: `<a tabIndex="0" onClick={() => void 0} />` },
  {
    code: `<Footer onClick={doFoo} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Footer: "footer",
          },
        },
      },
    },
  },
];
