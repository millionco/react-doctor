// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_no_useless_fragment.rs`
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
  { code: `<><Foo /><Bar /></>` },
  { code: `<>foo<div /></>` },
  { code: `<> <div /></>` },
  { code: `<>{"moo"} </>` },
  { code: `<NotFragment />` },
  { code: `<React.NotFragment />` },
  { code: `<NotReact.Fragment />` },
  { code: `<Foo><><div /><div /></></Foo>` },
  { code: `<div p={<>{"a"}{"b"}</>} />` },
  { code: `<Fragment key={item.id}>{item.value}</Fragment>` },
  { code: `<Fooo content={<>eeee ee eeeeeee eeeeeeee</>} />` },
  { code: `<>{foos.map(foo => foo)}</>` },
  { code: `<>{moo}</>`, oxcOptions: [{ allowExpressions: true }] },
  {
    code: `
        <>
            {moo}
        </>
        `,
    oxcOptions: [{ allowExpressions: true }],
  },
  { code: `{1 && <>{1}</>}`, oxcOptions: [{ allowExpressions: true }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<></>` },
  { code: `<>{}</>` },
  { code: `<p>moo<>foo</></p>` },
  { code: `<>{meow}</>` },
  { code: `<p><>{meow}</></p>` },
  { code: `<><div/></>` },
  {
    code: `
            <>
              <div/>
            </>
        `,
  },
  { code: `<Fragment />` },
  {
    code: `
                <React.Fragment>
                  <Foo />
                </React.Fragment>
            `,
  },
  { code: `<Eeee><>foo</></Eeee>` },
  { code: `<div><>foo</></div>` },
  { code: `<div><>{"a"}{"b"}</></div>` },
  { code: `<div><>{"a"}{"b"}</></div>` },
  {
    code: `
            <section>
              <Eeee />
              <Eeee />
              <>{"a"}{"b"}</>
            </section>`,
  },
  { code: `<div><Fragment>{"a"}{"b"}</Fragment></div>` },
  {
    code: `
            <section>
              git<>
                <b>hub</b>.
              </>

              git<> <b>hub</b></>
            </section>
            `,
  },
  { code: `<div>a <>{""}{""}</> a</div>` },
  {
    code: `
            const Comp = () => (
              <html>
                <React.Fragment />
              </html>
            );
        `,
  },
  { code: `<><Foo>{moo}</Foo></>` },
];
