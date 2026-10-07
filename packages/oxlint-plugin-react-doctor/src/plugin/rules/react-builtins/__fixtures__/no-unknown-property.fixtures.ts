// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_unknown_property.rs`
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
  { code: `<App class="bar" />;` },
  { code: `<App for="bar" />;` },
  { code: `<App someProp="bar" />;` },
  { code: `<Foo.bar for="bar" />;` },
  { code: `<App accept-charset="bar" />;` },
  { code: `<App http-equiv="bar" />;` },
  { code: `<App xlink:href="bar" />;` },
  { code: `<App clip-path="bar" />;` },
  { code: `<div className="bar"></div>;` },
  { code: `<div onMouseDown={this._onMouseDown}></div>;` },
  { code: `<div onScrollEnd={this._onScrollEnd}></div>;` },
  { code: `<div onScrollEndCapture={this._onScrollEndCapture}></div>;` },
  { code: `<a href="someLink" download="foo">Read more</a>` },
  { code: `<area download="foo" />` },
  { code: `<img src="cat_keyboard.jpeg" alt="A cat sleeping on a keyboard" align="top" />` },
  { code: `<input type="password" required />` },
  { code: `<input ref={this.input} type="radio" />` },
  { code: `<input type="file" webkitdirectory="" />` },
  { code: `<input type="file" webkitDirectory="" />` },
  { code: `<div inert children="anything" />` },
  { code: `<iframe scrolling="?" onLoad={a} onError={b} align="top" />` },
  { code: `<input key="bar" type="radio" />` },
  { code: `<button disabled>You cannot click me</button>;` },
  {
    code: `<svg key="lock" viewBox="box" fill={10} d="d" stroke={1} strokeWidth={2} strokeLinecap={3} strokeLinejoin={4} transform="something" clipRule="else" x1={5} x2="6" y1="7" y2="8"></svg>`,
  },
  { code: `<g fill="\\#7B82A0" fillRule="evenodd"></g>` },
  { code: `<mask fill="\\#7B82A0"></mask>` },
  { code: `<symbol fill="\\#7B82A0"></symbol>` },
  { code: `<meta property="og:type" content="website" />` },
  {
    code: `<input type="checkbox" checked={checked} disabled={disabled} id={id} onChange={onChange} />`,
  },
  { code: `<video playsInline />` },
  { code: `<img onError={foo} onLoad={bar} />` },
  { code: `<picture inert={false} onError={foo} onLoad={bar} />` },
  { code: `<iframe onError={foo} onLoad={bar} />` },
  { code: `<script onLoad={bar} onError={foo} />` },
  { code: `<source onLoad={bar} onError={foo} />` },
  { code: `<link onLoad={bar} onError={foo} />` },
  {
    code: `<link rel="preload" as="image" href="someHref" imageSrcSet="someImageSrcSet" imageSizes="someImageSizes" />`,
  },
  { code: `<object onLoad={bar} />` },
  { code: `<video allowFullScreen webkitAllowFullScreen mozAllowFullScreen />` },
  { code: `<iframe allowFullScreen webkitAllowFullScreen mozAllowFullScreen />` },
  { code: `<table border="1" />` },
  { code: `<th abbr="abbr" />` },
  { code: `<td abbr="abbr" />` },
  { code: `<div onPointerDown={this.onDown} onPointerUp={this.onUp} />` },
  { code: `<input type="checkbox" defaultChecked={this.state.checkbox} />` },
  {
    code: `<div onTouchStart={this.startAnimation} onTouchEnd={this.stopAnimation} onTouchCancel={this.cancel} onTouchMove={this.move} onMouseMoveCapture={this.capture} onTouchCancelCapture={this.log} />`,
  },
  { code: `<meta charset="utf-8" />;` },
  { code: `<meta charSet="utf-8" />;` },
  { code: `<div class="foo" is="my-elem"></div>;` },
  { code: `<div {...this.props} class="foo" is="my-elem"></div>;` },
  { code: `<atom-panel class="foo"></atom-panel>;` },
  { code: `<div data-foo="bar"></div>;` },
  { code: `<div data-foo-bar="baz"></div>;` },
  { code: `<div data-parent="parent"></div>;` },
  { code: `<div data-index-number="1234"></div>;` },
  { code: `<div data-e2e-id="5678"></div>;` },
  { code: `<div data-testID="bar" data-under_sCoRe="bar" />;` },
  {
    code: `<div data-testID="bar" data-under_sCoRe="bar" />;`,
    oxcOptions: [{ requireDataLowercase: false }],
  },
  { code: `<div class="bar"></div>;`, oxcOptions: [{ ignore: ["class"] }] },
  { code: `<div someProp="bar"></div>;`, oxcOptions: [{ ignore: ["someProp"] }] },
  { code: `<div css={{flex: 1}}></div>;`, oxcOptions: [{ ignore: ["css"] }] },
  { code: `<button aria-haspopup="true">Click me to open pop up</button>;` },
  { code: `<button aria-label="Close" onClick={someThing.close} />;` },
  { code: `<script crossOrigin noModule />` },
  { code: `<audio crossOrigin />` },
  { code: `<svg focusable><image crossOrigin /></svg>` },
  { code: `<details onToggle={this.onToggle}>Some details</details>` },
  {
    code: `<path fill="pink" d="M 10,30 A 20,20 0,0,1 50,30 A 20,20 0,0,1 90,30 Q 90,60 50,90 Q 10,60 10,30 z"></path>`,
  },
  { code: `<line fill="pink" x1="0" y1="80" x2="100" y2="20"></line>` },
  { code: `<link as="audio">Audio content</link>` },
  {
    code: `<video controlsList="nodownload" controls={this.controls} loop={true} muted={false} src={this.videoSrc} playsInline={true} onResize={this.onResize}></video>`,
  },
  {
    code: `<audio controlsList="nodownload" controls={this.controls} crossOrigin="anonymous" disableRemotePlayback loop muted preload="none" src="something" onAbort={this.abort} onDurationChange={this.durationChange} onEmptied={this.emptied} onEnded={this.end} onError={this.error} onResize={this.onResize}></audio>`,
  },
  {
    code: `<marker id={markerId} viewBox="0 0 2 2" refX="1" refY="1" markerWidth="1" markerHeight="1" orient="auto" />`,
  },
  { code: `<pattern id="pattern" viewBox="0,0,10,10" width="10%" height="10%" />` },
  { code: `<symbol id="myDot" width="10" height="10" viewBox="0 0 2 2" />` },
  { code: `<view id="one" viewBox="0 0 100 100" />` },
  { code: `<hr align="top" />` },
  { code: `<applet align="top" />` },
  { code: `<marker fill="\\#000" />` },
  {
    code: `<dialog closedby="something" onClose={handler} open id="dialog" returnValue="something" onCancel={handler2} />`,
  },
  { code: `<div popover="auto" />` },
  { code: `<button popoverTarget="locale-switcher" popoverTargetAction="show" />` },
  { code: `<input type="button" popoverTarget="locale-switcher" popoverTargetAction="show" />` },
  { code: `<img fetchPriority="low" src="foo.jpg" />` },
  { code: `<img fetchPriority="auto" src="foo.jpg" />` },
  { code: `<link fetchPriority="high" href="style.css" rel="stylesheet" />` },
  { code: `<script fetchPriority="high" src="script.js" />` },
  {
    code: `
			        <table align="top">
			          <caption align="top">Table Caption</caption>
			          <colgroup valign="top" align="top">
			            <col valign="top" align="top"/>
			          </colgroup>
			          <thead valign="top" align="top">
			            <tr valign="top" align="top">
			              <th valign="top" align="top">Header</th>
			              <td valign="top" align="top">Cell</td>
			            </tr>
			          </thead>
			          <tbody valign="top" align="top" />
			          <tfoot valign="top" align="top" />
			        </table>
			      `,
  },
  { code: `<fbt desc="foo" doNotExtract />;` },
  { code: `<fbs desc="foo" doNotExtract />;` },
  { code: `<math displaystyle="true" />;` },
  {
    code: `
			        <div className="App" data-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash="customValue">
			          Hello, world!
			        </div>
			      `,
  },
  { code: `<rect transform-origin="center" />` },
  {
    code: `<template shadowrootmode="open" shadowrootclonable shadowrootdelegatesfocus shadowrootserializable />`,
  },
  {
    code: `
                <div>
                  <button popoverTarget="my-popover" popoverTargetAction="toggle">Open Popover</button>
                  <div id="my-popover" onBeforeToggle={this.onBeforeToggle} popover>Greetings, one and all!</div>
                </div>
            `,
  },
  {
    code: `
                <div>
                  <p>hello</p>
                  <link rel="stylesheet" href="baz" precedence="default" />
                </div>
            `,
  },
  { code: `<style precedence="default" href="custom-style">{\`body { color: red; }\`}</style>` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div allowTransparency="true" />` },
  { code: `<div hasOwnProperty="should not be allowed property"></div>;` },
  { code: `<div abc="should not be allowed property"></div>;` },
  { code: `<div aria-fake="should not be allowed property"></div>;` },
  { code: `<div someProp="bar"></div>;` },
  { code: `<div class="bar"></div>;` },
  { code: `<div for="bar"></div>;` },
  { code: `<div accept-charset="bar"></div>;` },
  { code: `<div http-equiv="bar"></div>;` },
  { code: `<div accesskey="bar"></div>;` },
  { code: `<div onclick="bar"></div>;` },
  { code: `<div onmousedown="bar"></div>;` },
  { code: `<div onMousedown="bar"></div>;` },
  { code: `<use xlink:href="bar" />;` },
  { code: `<rect clip-path="bar" />;` },
  { code: `<script crossorigin nomodule />` },
  { code: `<div crossorigin />` },
  { code: `<div crossOrigin />` },
  { code: `<div as="audio" />` },
  {
    code: `<div onAbort={this.abort} onDurationChange={this.durationChange} onEmptied={this.emptied} onEnded={this.end} onResize={this.resize} onError={this.error} />`,
  },
  { code: `<div onLoad={this.load} />` },
  { code: `<div fill="pink" />` },
  {
    code: `<div controls={this.controls} loop={true} muted={false} src={this.videoSrc} playsInline={true} allowFullScreen></div>`,
  },
  { code: `<div download="foo" />` },
  { code: `<div imageSrcSet="someImageSrcSet" />` },
  { code: `<div imageSizes="someImageSizes" />` },
  { code: `<div popoverTarget="locale-switcher" />` },
  { code: `<div popoverTargetAction="show" />` },
  { code: `<div fetchPriority="high" />` },
  { code: `<img fetchpriority="high" src="foo.jpg" />` },
  { code: `<link fetchpriority="high" href="style.css" rel="stylesheet" />` },
  { code: `<script fetchpriority="high" src="script.js" />` },
  { code: `<div data-xml-anything="invalid" />` },
  {
    code: `<div data-testID="bar" data-under_sCoRe="bar" />;`,
    oxcOptions: [{ requireDataLowercase: true }],
  },
  { code: `<div abbr="abbr" />` },
  { code: `<div webkitDirectory="" />` },
  { code: `<div webkitdirectory="" />` },
  {
    code: `
			        <div className="App" data-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash-crash:c="customValue">
			          Hello, world!
			        </div>
			      `,
  },
  { code: `<t onChñnge/>` },
  { code: `<div precedence="default" />` },
  { code: `<script precedence="high" src="foo.js" />` },
];
