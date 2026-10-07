// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_curly_brace_presence.rs`
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
  { code: `<App {...props}>foo</App>` },
  { code: `<>foo</>` },
  { code: `<App {...props}>foo</App>`, oxcOptions: [{ props: "never" }] },
  { code: `<App>{' '}</App>` },
  {
    code: `<App>{' '}
            </App>`,
  },
  { code: `<App>{'     '}</App>` },
  {
    code: `<App>{'     '}
            </App>`,
  },
  { code: `<App>{' '}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<App>{'    '}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<App>{' '}</App>`, oxcOptions: [{ children: "always" }] },
  { code: `<App>{'        '}</App>`, oxcOptions: [{ children: "always" }] },
  { code: `<App {...props}>foo</App>`, oxcOptions: [{ props: "always" }] },
  { code: `<App>{\`Hello \${word} World\`}</App>`, oxcOptions: [{ children: "never" }] },
  {
    code: `
                    <React.Fragment>
                      foo{' '}
                      <span>bar</span>
                    </React.Fragment>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <>
                      foo{' '}
                      <span>bar</span>
                    </>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `<App>{\`Hello 
 World\`}</App>`,
    oxcOptions: [{ children: "never" }],
  },
  { code: `<App>{\`Hello \${word} World\`}{\`foo\`}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<App prop={\`foo \${word} bar\`}>foo</App>`, oxcOptions: [{ props: "never" }] },
  { code: `<App prop={\`foo \${word} bar\`} />`, oxcOptions: [{ props: "never" }] },
  { code: `<App>{<myApp></myApp>}</App>`, oxcOptions: [{ children: "always" }] },
  { code: `<App>{[]}</App>` },
  { code: `<App>foo</App>` },
  { code: `<App>{"foo"}{<Component>bar</Component>}</App>` },
  { code: `<App prop='bar'>foo</App>` },
  { code: `<App prop={true}>foo</App>` },
  { code: `<App prop>foo</App>` },
  { code: `<App prop='bar'>{'foo \\n bar'}</App>` },
  { code: `<App prop={ ' ' }/>` },
  { code: `<MyComponent prop='bar'>foo</MyComponent>`, oxcOptions: [{ props: "never" }] },
  { code: `<MyComponent prop="bar">foo</MyComponent>`, oxcOptions: [{ props: "never" }] },
  { code: `<MyComponent>foo</MyComponent>`, oxcOptions: [{ children: "never" }] },
  { code: `<MyComponent>{<App/>}{"123"}</MyComponent>`, oxcOptions: [{ children: "never" }] },
  { code: `<App>{"foo 'bar' \\"foo\\" bar"}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<MyComponent prop={'bar'}>foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent>{'foo'}</MyComponent>`, oxcOptions: [{ children: "always" }] },
  { code: `<MyComponent prop={"bar"}>foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent>{"foo"}</MyComponent>`, oxcOptions: [{ children: "always" }] },
  { code: `<MyComponent>{'foo'}</MyComponent>`, oxcOptions: [{ children: "ignore" }] },
  { code: `<MyComponent prop={'bar'}>foo</MyComponent>`, oxcOptions: [{ props: "ignore" }] },
  { code: `<MyComponent>foo</MyComponent>`, oxcOptions: [{ children: "ignore" }] },
  { code: `<MyComponent prop='bar'>foo</MyComponent>`, oxcOptions: [{ props: "ignore" }] },
  { code: `<MyComponent prop="bar">foo</MyComponent>`, oxcOptions: [{ props: "ignore" }] },
  {
    code: `<MyComponent prop='bar'>{'foo'}</MyComponent>`,
    oxcOptions: [{ children: "always", props: "never" }],
  },
  {
    code: `<MyComponent prop={'bar'}>foo</MyComponent>`,
    oxcOptions: [{ children: "never", props: "always" }],
  },
  { code: `<MyComponent prop={'bar'}>{'foo'}</MyComponent>`, oxcOptions: ["always"] },
  { code: `<MyComponent prop={"bar"}>{"foo"}</MyComponent>`, oxcOptions: ["always"] },
  { code: `<MyComponent prop={"bar"} attr={'foo'} />`, oxcOptions: ["always"] },
  { code: `<MyComponent prop="bar" attr='foo' />`, oxcOptions: ["never"] },
  { code: `<MyComponent prop='bar'>foo</MyComponent>`, oxcOptions: ["never"] },
  {
    code: `<MyComponent prop={\`bar \${word} foo\`}>{\`foo \${word}\`}</MyComponent>`,
    oxcOptions: ["never"],
  },
  { code: `<MyComponent>{"div { margin-top: 0; }"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{"<Foo />"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent prop={"Hello \\u1026 world"}>bar</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{"Hello \\u1026 world"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent prop={"Hello &middot; world"}>bar</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{"Hello &middot; world"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{"Hello \\n world"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{"space after "}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{" space before"}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{\`space after \`}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent>{\` space before\`}</MyComponent>`, oxcOptions: ["never"] },
  {
    code: `
                    <App prop={\`
                      a
                      b
                    \`} />
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    <App prop={\`
                      a
                      b
                    \`} />
                  `,
    oxcOptions: ["always"],
  },
  {
    code: `
                    <App>
                      {\`
                        a
                        b
                      \`}
                    </App>
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    <App>{\`
                      a
                      b
                    \`}</App>
                  `,
    oxcOptions: ["always"],
  },
  {
    code: `
                    <MyComponent>
                      %
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent>
                      { 'space after ' }
                      <b>foo</b>
                      { ' space before' }
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent>
                      { \`space after \` }
                      <b>foo</b>
                      { \` space before\` }
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent>
                      foo
                      <div>bar</div>
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent p={<Foo>Bar</Foo>}>
                    </MyComponent>
                  `,
  },
  {
    code: `
                    <MyComponent>
                      <div>
                        <p>
                          <span>
                            {"foo"}
                          </span>
                        </p>
                      </div>
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "always" }],
  },
  {
    code: `
                    <App>
                      <Component />&nbsp;
                      &nbsp;
                    </App>
                  `,
    oxcOptions: [{ children: "always" }],
  },
  {
    code: `
                    const Component2 = () => {
                      return <span>/*</span>;
                    };
                  `,
  },
  {
    code: `
                    const Component2 = () => {
                      return <span>/*</span>;
                    };
                  `,
    oxcOptions: [{ props: "never", children: "never" }],
  },
  {
    code: `
                    import React from "react";

                    const Component = () => {
                      return <span>{"/*"}</span>;
                    };
                  `,
    oxcOptions: [{ props: "never", children: "never" }],
  },
  { code: `<App>{/* comment */}</App>` },
  { code: `<App horror=<div /> />` },
  { code: `<App horror={<div />} />` },
  { code: `<App horror=<div /> />`, oxcOptions: [{ propElementValues: "ignore" }] },
  { code: `<App horror={<div />} />`, oxcOptions: [{ propElementValues: "ignore" }] },
  {
    code: `
                    <script>{\`window.foo = "bar"\`}</script>
                  `,
  },
  {
    code: `
                    <CollapsibleTitle
                      extra={<span className="activity-type">{activity.type}</span>}
                    />
                  `,
    oxcOptions: ["never"],
  },
  { code: `<App label={\`\${label}\`} />`, oxcOptions: ["never"] },
  { code: `<App>{\`\${label}\`}</App>`, oxcOptions: ["never"] },
  { code: `<div>{\`Nobody's "here"\`}</div>` },
  { code: `<Foo bar={\`a "x" 'y'\`} />;`, oxcOptions: ["never"] },
  { code: `<App>{<Component>{/* keep */}</Component>}</App>` },
  { code: `<Component name={/* This is a comment */ 'test'} />` },
  {
    code: `
                    <ComponentA>
                        {
                            // This is another comment
                            <ComponentB />
                        }
                    </ComponentA>;
                  `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<App prop={\`foo\`} />`, oxcOptions: [{ props: "never" }] },
  { code: `<App>{<myApp></myApp>}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<App>{<myApp></myApp>}</App>` },
  { code: `<App prop={\`foo\`}>foo</App>`, oxcOptions: [{ props: "never" }] },
  { code: `<App>{\`foo\`}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<>{\`foo\`}</>`, oxcOptions: [{ children: "never" }] },
  { code: `<MyComponent>{'foo'}</MyComponent>` },
  { code: `<MyComponent prop={'bar'}>foo</MyComponent>` },
  { code: `<MyComponent>{'foo'}</MyComponent>`, oxcOptions: [{ children: "never" }] },
  { code: `<MyComponent prop={'bar'}>foo</MyComponent>`, oxcOptions: [{ props: "never" }] },
  {
    code: `
                    <MyComponent>
                      {'%'}
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent>
                      {'foo'}
                      <div>
                        {'bar'}
                      </div>
                      {'baz'}
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  {
    code: `
                    <MyComponent>
                      {'foo'}
                      <div>
                        {'bar'}
                      </div>
                      {'baz'}
                      {'some-complicated-exp'}
                    </MyComponent>
                  `,
    oxcOptions: [{ children: "never" }],
  },
  { code: `<MyComponent prop='bar'>foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent prop="foo 'bar'">foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent prop='foo "bar"'>foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent prop="foo 'bar'">foo</MyComponent>`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent>foo bar </MyComponent>`, oxcOptions: [{ children: "always" }] },
  {
    code: `<MyComponent prop="foo 'bar' \\n ">foo</MyComponent>`,
    oxcOptions: [{ props: "always" }],
  },
  {
    code: `<MyComponent>foo bar 
 </MyComponent>`,
    oxcOptions: [{ children: "always" }],
  },
  { code: `<MyComponent>foo bar 'foo'</MyComponent>`, oxcOptions: [{ children: "always" }] },
  { code: `<MyComponent>foo bar "foo"</MyComponent>`, oxcOptions: [{ children: "always" }] },
  { code: `<MyComponent>foo bar <App/></MyComponent>`, oxcOptions: [{ children: "always" }] },
  {
    code: `<MyComponent>foo 
 bar</MyComponent>`,
    oxcOptions: [{ children: "always" }],
  },
  { code: `<MyComponent>foo \\u1234 bar</MyComponent>`, oxcOptions: [{ children: "always" }] },
  { code: `<MyComponent prop='foo \\u1234 bar' />`, oxcOptions: [{ props: "always" }] },
  { code: `<MyComponent prop={'bar'}>{'foo'}</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent prop='bar'>foo</MyComponent>`, oxcOptions: ["always"] },
  { code: `<App prop={'foo'} attr={" foo "} />`, oxcOptions: [{ props: "never" }] },
  { code: `<App prop='foo' attr="bar" />`, oxcOptions: [{ props: "always" }] },
  { code: `<App prop='foo' attr={"bar"} />`, oxcOptions: [{ props: "always" }] },
  { code: `<App prop={'foo'} attr='bar' />`, oxcOptions: [{ props: "always" }] },
  { code: `<App prop='foo &middot; bar' />`, oxcOptions: [{ props: "always" }] },
  { code: `<App>foo &middot; bar</App>`, oxcOptions: [{ children: "always" }] },
  { code: `<App>{'foo "bar"'}</App>`, oxcOptions: [{ children: "never" }] },
  { code: `<App>{"foo 'bar'"}</App>`, oxcOptions: [{ children: "never" }] },
  {
    code: `
                    <App prop="" />`,
    oxcOptions: ["always"],
  },
  {
    code: `
                    <App prop='' />`,
    oxcOptions: ["always"],
  },
  {
    code: `
                    <App>
                      foo bar
                      <div>foo bar foo</div>
                      <span>
                        foo bar <i>foo bar</i>
                        <strong>
                          foo bar
                        </strong>
                      </span>
                    </App>
                  `,
    oxcOptions: [{ children: "always" }],
  },
  {
    code: `
                    <App>
                      &lt;Component&gt;
                      &nbsp;<Component />&nbsp;
                      &nbsp;
                    </App>
                  `,
    oxcOptions: [{ children: "always" }],
  },
  {
    code: `
                    <Box mb={'1rem'} />
                  `,
    oxcOptions: [{ props: "never" }],
  },
  {
    code: `
                    <Box mb={'1rem {}'} />
                  `,
    oxcOptions: ["never"],
  },
  { code: `<MyComponent prop={"{ style: true }"}>bar</MyComponent>`, oxcOptions: ["never"] },
  { code: `<MyComponent prop={"< style: true >"}>foo</MyComponent>`, oxcOptions: ["never"] },
  {
    code: `<App horror=<div /> />`,
    oxcOptions: [{ props: "always", children: "always", propElementValues: "always" }],
  },
  {
    code: `<App horror={<div />} />`,
    oxcOptions: [{ props: "never", children: "never", propElementValues: "never" }],
  },
  {
    code: `<Foo bar={"'"} />`,
    oxcOptions: [{ props: "never", children: "never", propElementValues: "never" }],
  },
  {
    code: `
                    <Foo help={'The maximum time range for searches. (i.e. "P30D" for 30 days, "PT24H" for 24 hours)'} />
                  `,
    oxcOptions: ["never"],
  },
  { code: `<Image alt={""} />`, oxcOptions: [{ props: "never", children: "never" }] },
  { code: `<App>{""}</App>`, oxcOptions: [{ props: "never", children: "never" }] },
];
