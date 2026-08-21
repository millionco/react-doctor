// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/mouse_events_have_key_events.rs`
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
  { code: `<div onMouseOver={() => void 0} onFocus={() => void 0} />;` },
  { code: `<div onMouseOver={() => void 0} onFocus={() => void 0} {...props} />;` },
  { code: `<div onMouseOver={handleMouseOver} onFocus={handleFocus} />;` },
  { code: `<div onMouseOver={handleMouseOver} onFocus={handleFocus} {...props} />;` },
  { code: `<div />;` },
  { code: `<div onBlur={() => {}} />` },
  { code: `<div onFocus={() => {}} />` },
  { code: `<div onMouseOut={() => void 0} onBlur={() => void 0} />` },
  { code: `<div onMouseOut={() => void 0} onBlur={() => void 0} {...props} />` },
  { code: `<div onMouseOut={handleMouseOut} onBlur={handleOnBlur} />` },
  { code: `<div onMouseOut={handleMouseOut} onBlur={handleOnBlur} {...props} />` },
  { code: `<MyElement />` },
  { code: `<MyElement onMouseOver={() => {}} />` },
  { code: `<MyElement onMouseOut={() => {}} />` },
  { code: `<MyElement onBlur={() => {}} />` },
  { code: `<MyElement onFocus={() => {}} />` },
  { code: `<MyElement onMouseOver={() => {}} {...props} />` },
  { code: `<MyElement onMouseOut={() => {}} {...props} />` },
  { code: `<MyElement onBlur={() => {}} {...props} />` },
  { code: `<MyElement onFocus={() => {}} {...props} />` },
  {
    code: `<div onMouseOver={() => {}} onMouseOut={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: [], hoverOutHandlers: [] }],
  },
  {
    code: `<div onMouseOver={() => {}} onFocus={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onMouseOver"] }],
  },
  {
    code: `<div onMouseEnter={() => {}} onFocus={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onMouseEnter"] }],
  },
  {
    code: `<div onMouseOut={() => {}} onBlur={() => {}} />`,
    oxcOptions: [{ hoverOutHandlers: ["onMouseOut"] }],
  },
  {
    code: `<div onMouseLeave={() => {}} onBlur={() => {}} />`,
    oxcOptions: [{ hoverOutHandlers: ["onMouseLeave"] }],
  },
  {
    code: `<div onMouseOver={() => {}} onMouseOut={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onPointerEnter"], hoverOutHandlers: ["onPointerLeave"] }],
  },
  {
    code: `<div onMouseLeave={() => {}} />`,
    oxcOptions: [{ hoverOutHandlers: ["onPointerLeave"] }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div onMouseOver={() => void 0} />;` },
  { code: `<div onMouseOut={() => void 0} />` },
  { code: `<div onMouseOver={() => void 0} onFocus={undefined} />;` },
  { code: `<div onMouseOut={() => void 0} onBlur={undefined} />` },
  { code: `<div onMouseOver={() => void 0} {...props} />` },
  { code: `<div onMouseOut={() => void 0} {...props} />` },
  {
    code: `<div onMouseOver={() => {}} onMouseOut={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onMouseOver"], hoverOutHandlers: ["onMouseOut"] }],
  },
  {
    code: `<div onPointerEnter={() => {}} onPointerLeave={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onPointerEnter"], hoverOutHandlers: ["onPointerLeave"] }],
  },
  { code: `<div onMouseOver={() => {}} />`, oxcOptions: [{ hoverInHandlers: ["onMouseOver"] }] },
  {
    code: `<div onPointerEnter={() => {}} />`,
    oxcOptions: [{ hoverInHandlers: ["onPointerEnter"] }],
  },
  { code: `<div onMouseOut={() => {}} />`, oxcOptions: [{ hoverOutHandlers: ["onMouseOut"] }] },
  {
    code: `<div onPointerLeave={() => {}} />`,
    oxcOptions: [{ hoverOutHandlers: ["onPointerLeave"] }],
  },
];
