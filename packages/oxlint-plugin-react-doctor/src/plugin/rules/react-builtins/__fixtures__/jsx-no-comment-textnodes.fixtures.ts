// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_no_comment_textnodes.rs`
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
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			                {/* valid */}
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <>
			                {/* valid */}
			              </>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (<div>{/* valid */}</div>);
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            const bar = (<div>{/* valid */}</div>);
			            return bar;
			          }
			        }
			      `,
  },
  {
    code: `
			        var Hello = createReactClass({
			          foo: (<div>{/* valid */}</div>),
			          render() {
			            return this.foo;
			          },
			        });
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			                {/* valid */}
			                {/* valid 2 */}
			                {/* valid 3 */}
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        var foo = require('foo');
			      `,
  },
  {
    code: `
			        <Foo bar='test'>
			          {/* valid */}
			        </Foo>
			      `,
  },
  {
    code: `
			        <strong>
			          &nbsp;https://www.example.com/attachment/download/1
			        </strong>
			      `,
  },
  {
    code: `
			        <Foo /* valid */ placeholder={'foo'}/>
			      `,
  },
  {
    code: `
			        </* valid */></>
			      `,
  },
  {
    code: `
			        <></* valid *//>
			      `,
  },
  {
    code: `
			        <Foo title={'foo' /* valid */}/>
			      `,
  },
  { code: `<pre>&#x2F;&#x2F; TODO: Write perfect code</pre>` },
  { code: `<pre>&#x2F;&#42; TODO: Write perfect code &#42;&#x2F;</pre>` },
  {
    code: `
			        <div>
			          <span className="pl-c"><span className="pl-c">&#47;&#47;</span> ...</span><br />
			        </div>
			      `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (<div>// invalid</div>);
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (<>// invalid</>);
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (<div>/* invalid */</div>);
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			                // invalid
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			                asdjfl
			                /* invalid */
			                foo
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        class Comp1 extends Component {
			          render() {
			            return (
			              <div>
			                {'asdjfl'}
			                // invalid
			                {'foo'}
			              </div>
			            );
			          }
			        }
			      `,
  },
  {
    code: `
			        const Component2 = () => {
			          return <span>/*</span>;
			        };
			      `,
  },
];
