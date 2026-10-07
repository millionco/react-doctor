// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/state_in_constructor.rs`
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
                    class Foo extends React.Component {
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["always"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.baz = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.baz = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    const Foo = () => <div>Foo</div>
                  `,
  },
  {
    code: `
                    const Foo = () => <div>Foo</div>
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    function Foo () {
                      return <div>Foo</div>
                    }
                  `,
  },
  {
    code: `
                    function Foo () {
                      return <div>Foo</div>
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        class Bar {
                          method() {
                            this.state = { bar: 0 }
                          }
                        }
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      state = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      state = { bar: 0 }
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.baz = { bar: 0 }
                      }
                      state = { baz: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        if (foobar) {
                          this.state = { bar: 0 }
                        }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        foobar = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        foobar = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      state = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      state = { bar: 0 }
                      baz = { bar: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.baz = { bar: 0 }
                      }
                      state = { baz: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      state = { baz: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        this.state = { bar: 0 }
                      }
                      state = { baz: 0 }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
                    class Foo extends React.Component {
                      constructor(props) {
                        super(props)
                        if (foobar) {
                          this.state = { bar: 0 }
                        }
                      }
                      render() {
                        return <div>Foo</div>
                      }
                    }
                  `,
    oxcOptions: ["never"],
  },
  {
    code: `
              class Foo extends React.Component {
                  constructor(props) {
                      super(props);

                      function helper() {
                          this.state = {bar: 0};
                      }

                      helper();
                  }
              }
                  `,
    oxcOptions: ["never"],
  },
];
