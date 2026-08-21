// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_direct_mutation_state.rs`
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
    code: `var Hello = createReactClass({
          render: function() {
            return <div>Hello {this.props.name}</div>;
          }
        });`,
  },
  {
    code: `
          var Hello = createReactClass({
            render: function() {
              var obj = {state: {}};
              obj.state.name = 'foo';
              return <div>Hello {obj.state.name}</div>;
            }
          });
        `,
  },
  {
    code: `
           var Hello = 'foo';
           module.exports = {};
         `,
  },
  {
    code: `
           class Hello {
             getFoo() {
               this.state.foo = 'bar'
               return this.state.foo;
             }
           }
         `,
  },
  {
    code: `
           class Hello extends React.Component {
             constructor() {
               this.state.foo = 'bar'
             }
           }
         `,
  },
  {
    code: `
        class Hello extends React.Component {
          constructor() {
            this.state.foo = 1;
          }
        }
      `,
  },
  {
    code: `
       class OneComponent extends Component {
         constructor() {
           super();
           class AnotherComponent extends Component {
             constructor() {
               super();
             }
           }
           this.state = {};
         }
       }
     `,
  },
  {
    code: `
     describe('Component spec', () => {
        it('should apply default props on rerender', () => {
          class Outer extends Component {
            constructor() {
              super();
              this.state = { i: 1 };
            }
          }
        });
     });
`,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                  var Hello = createReactClass({

                    componentWillMount() {
                      this.state.foo = "Chicken, you're so beautiful"
                    },

                          render: function() {
                            this.state.foo = "Chicken, you're so beautiful"
                            return <div>Hello{this.props.name} <Hello2/></div>;
                          }
                        });

                  var Hello2 = createReactClass({
                          render: () => {
                             this.state.foo = "Chicken, you're so beautiful"
                            return <div>Hello {this.props.name}</div>;
                          }
                        });
          `,
  },
  {
    code: `
                 var Hello = createReactClass({
                   render: function() {
                     this.state.foo++;
                     return <div>Hello {this.props.name}</div>;
                   }
                 });
               `,
  },
  {
    code: `
        var Hello = createReactClass({
          render: function() {
            this.state.person.name= "bar"
            return <div>Hello {this.props.name}</div>;
          }
        });
      `,
  },
  {
    code: `
          var Hello = createReactClass({
            render: function() {
              this.state.person.name.first = "bar"
              return <div>Hello</div>;
            }
          });
        `,
  },
  {
    code: `
          var Hello = createReactClass({
            render: function() {
              this.state.person.name.first = "bar"
              this.state.person.name.last = "baz"
              return <div>Hello</div>;
            }
          });
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            constructor() {
              someFn()
            }
            someFn() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            constructor(props) {
              super(props)
              doSomethingAsync(() => {
                this.state = "bad";
              });
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentWillMount() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentDidMount() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentWillReceiveProps() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            shouldComponentUpdate() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentWillUpdate() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentDidUpdate() {
              this.state.foo = "bar"
            }
          }
        `,
  },
  {
    code: `
          class Hello extends React.Component {
            componentWillUnmount() {
              this.state.foo = "bar"
            }
          }
        `,
  },
];
