// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/self_closing_comp.rs`
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
  { code: `var HelloJohn = <Hello name="John" />;` },
  { code: `var HelloJohn = <Hello.Compound name="John" />;` },
  { code: `var Profile = <Hello name="John"><img src="picture.png" /></Hello>;` },
  { code: `var Profile = <Hello.Compound name="John"><img src="picture.png" /></Hello.Compound>;` },
  {
    code: `
			        <Hello>
			          <Hello name="John" />
			        </Hello>
			      `,
  },
  {
    code: `
			        <Hello.Compound>
			          <Hello.Compound name="John" />
			        </Hello.Compound>
			      `,
  },
  { code: `var HelloJohn = <Hello name="John"> </Hello>;` },
  { code: `var HelloJohn = <Hello.Compound name="John"> </Hello.Compound>;` },
  { code: `var HelloJohn = <Hello name="John">        </Hello>;` },
  { code: `var HelloJohn = <Hello.Compound name="John">        </Hello.Compound>;` },
  { code: `var HelloJohn = <div>&nbsp;</div>;` },
  { code: `var HelloJohn = <div>{' '}</div>;` },
  { code: `var HelloJohn = <Hello name="John">&nbsp;</Hello>;` },
  { code: `var HelloJohn = <Hello.Compound name="John">&nbsp;</Hello.Compound>;` },
  { code: `var HelloJohn = <Hello name="John" />;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello.Compound name="John" />;`, oxcOptions: [] },
  { code: `var Profile = <Hello name="John"><img src="picture.png" /></Hello>;`, oxcOptions: [] },
  {
    code: `var Profile = <Hello.Compound name="John"><img src="picture.png" /></Hello.Compound>;`,
    oxcOptions: [],
  },
  {
    code: `<Hello>
		    <Hello name="John" />
		    </Hello>
	    `,
    oxcOptions: [],
  },
  {
    code: `<Hello.Compound>
		<Hello.Compound name="John" />
		</Hello.Compound>
	    `,
    oxcOptions: [],
  },
  { code: `var HelloJohn = <div> </div>;`, oxcOptions: [] },
  { code: `var HelloJohn = <div>        </div>;`, oxcOptions: [] },
  { code: `var HelloJohn = <div>&nbsp;</div>;`, oxcOptions: [] },
  { code: `var HelloJohn = <div>{' '}</div>;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello name="John">&nbsp;</Hello>;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello.Compound name="John">&nbsp;</Hello.Compound>;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello name="John"></Hello>;`, oxcOptions: [{ component: false }] },
  {
    code: `var HelloJohn = <Hello.Compound name="John"></Hello.Compound>;`,
    oxcOptions: [{ component: false }],
  },
  {
    code: `var HelloJohn = <Hello name="John">
			</Hello>;`,
    oxcOptions: [{ component: false }],
  },
  {
    code: `var HelloJohn = <Hello.Compound name="John">
			</Hello.Compound>;`,
    oxcOptions: [{ component: false }],
  },
  { code: `var HelloJohn = <Hello name="John"> </Hello>;`, oxcOptions: [{ component: false }] },
  {
    code: `var HelloJohn = <Hello.Compound name="John"> </Hello.Compound>;`,
    oxcOptions: [{ component: false }],
  },
  { code: `var contentContainer = <div className="content" />;`, oxcOptions: [{ html: true }] },
  {
    code: `var contentContainer = <div className="content"><img src="picture.png" /></div>;`,
    oxcOptions: [{ html: true }],
  },
  {
    code: `
			        <div>
			          <div className="content" />
			        </div>
			      `,
    oxcOptions: [{ html: true }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `var contentContainer = <div className="content"></div>;` },
  { code: `var contentContainer = <div className="content"></div>;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello name="John"></Hello>;` },
  { code: `var CompoundHelloJohn = <Hello.Compound name="John"></Hello.Compound>;` },
  {
    code: `const HelloJohn = <Hello name="John">
			</Hello>;`,
  },
  {
    code: `var HelloJohn = <Hello.Compound name="John">
			</Hello.Compound>;`,
  },
  { code: `var HelloJohn = <Hello name="John"></Hello>;`, oxcOptions: [] },
  { code: `var HelloJohn = <Hello.Compound name="John"></Hello.Compound>;`, oxcOptions: [] },
  {
    code: `var HelloJohn = <Hello name="John">
			</Hello>;`,
    oxcOptions: [],
  },
  {
    code: `var HelloJohn = <Hello.Compound name="John">
			</Hello.Compound>;`,
    oxcOptions: [],
  },
  { code: `var contentContainer = <div className="content"></div>;`, oxcOptions: [{ html: true }] },
  {
    code: `var contentContainer = <div className="content">
			</div>;`,
    oxcOptions: [{ html: true }],
  },
];
