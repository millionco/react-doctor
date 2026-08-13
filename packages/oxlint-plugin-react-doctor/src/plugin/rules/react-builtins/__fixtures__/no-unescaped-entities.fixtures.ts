// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_unescaped_entities.rs`
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
        var Hello = createReactClass({
          render: function() {
            return (
              <div/>
            );
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <div>Here is some text!</div>;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <div>I&rsquo;ve escaped some entities: &gt; &lt; &amp;</div>;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <div>first line is ok
            so is second
            and here are some escaped entities: &gt; &lt; &amp;</div>;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <div>{">" + "<" + "&" + '"'}</div>;
          },
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <>Here is some text!</>;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <>I&rsquo;ve escaped some entities: &gt; &lt; &amp;</>;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            return <>{">" + "<" + "&" + '"'}</>;
          },
        });
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `var Hello = createReactClass({
            render: function() {
              return <>> babel-eslint</>;
            }
          });`,
  },
  {
    code: `var Hello = createReactClass({
            render: function() {
              return <>first line is ok
              so is second
              and here are some bad entities: ></>
            }
          });`,
  },
  {
    code: `
        var Hello = createReactClass({
            render: function() {
              return <div>'</div>;
            }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
            render: function() {
              return <>{"Unbalanced braces - babel-eslint"}}</>;
            }
          });
        `,
  },
  { code: `<script>测试 " 测试</script>` },
];
