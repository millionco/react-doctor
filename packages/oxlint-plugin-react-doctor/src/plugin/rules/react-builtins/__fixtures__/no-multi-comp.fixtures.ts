// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_multi_comp.rs`
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
    code: `var Hello = require('./components/Hello');
            var HelloJohn = createReactClass({
              render: function() {
                return <Hello name="John" />;
              }
            });`,
  },
  {
    code: `class Hello extends React.Component {
            render() {
              return <div>Hello {this.props.name}</div>;
            }
          }`,
  },
  {
    code: `var Heading = createReactClass({
            render: function() {
              return (
                <div>
                  {this.props.buttons.map(function(button, index) {
                    return <Button {...button} key={index}/>;
                  })}
                </div>
              );
            }
          });`,
  },
  {
    code: `function Hello(props) {
            return <div>Hello {props.name}</div>;
          }
          function HelloAgain(props) {
            return <div>Hello again {props.name}</div>;
          }`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `function Hello(props) {
              return <div>Hello {props.name}</div>;
            }
            class HelloJohn extends React.Component {
              render() {
                return <Hello name="John" />;
              }
            }`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `import React, { createElement } from "react"
            const helperFoo = () => {
              return true;
            };
            function helperBar() {
              return false;
            };
            function RealComponent() {
              return createElement("img");
            };`,
  },
  {
    code: `const Hello = React.memo(function(props) {
              return <div>Hello {props.name}</div>;
            });
            class HelloJohn extends React.Component {
              render() {
                return <Hello name="John" />;
              }
            }`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `class StoreListItem extends React.PureComponent {
            // A bunch of stuff here
          }
          export default React.forwardRef((props, ref) => <StoreListItem {...props} forwardRef={ref} />);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `class StoreListItem extends React.PureComponent {
            // A bunch of stuff here
          }
          export default React.forwardRef((props, ref) => {
            return <StoreListItem {...props} forwardRef={ref} />
          });`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const HelloComponent = (props) => {
            return <div></div>;
          }
          export default React.forwardRef((props, ref) => <HelloComponent {...props} forwardRef={ref} />);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `class StoreListItem extends React.PureComponent {
            // A bunch of stuff here
          }
          export default React.forwardRef(
            function myFunction(props, ref) {
              return <StoreListItem {...props} forwardedRef={ref} />;
            }
          );`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `const HelloComponent = (props) => {
            return <div></div>;
          }
          class StoreListItem extends React.PureComponent {
            // A bunch of stuff here
          }
          export default React.forwardRef(
            function myFunction(props, ref) {
              return <StoreListItem {...props} forwardedRef={ref} />;
            }
          );`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `const HelloComponent = (props) => {
              return <div></div>;
            }
            export default React.memo((props, ref) => <HelloComponent {...props} />);`,
    oxcOptions: [{ ignoreStateless: true }],
  },
  {
    code: `import React from 'react';
            function memo() {
              var outOfScope = "hello"
              return null;
            }
            class ComponentY extends React.Component {
              memoCities = memo((cities) => cities.map((v) => ({ label: v })));
              render() {
                return (
                  <div>
                    <div>Counter</div>
                  </div>
                );
              }
            }`,
  },
  {
    code: `const MenuList = forwardRef(({onClose, ...props}, ref) => {
              const {t} = useTranslation();
              const handleLogout = useLogoutHandler();

              const onLogout = useCallback(() => {
                onClose();
                handleLogout();
              }, [onClose, handleLogout]);

              return (
                <MuiMenuList ref={ref} {...props}>
                  <MuiMenuItem key="logout" onClick={onLogout}>
                    {t('global-logout')}
                  </MuiMenuItem>
                </MuiMenuList>
              );
            });

            MenuList.displayName = 'MenuList';

            MenuList.propTypes = {
              onClose: PropTypes.func,
            };

            MenuList.defaultProps = {
              onClose: () => null,
            };

            export default MenuList;`,
  },
  {
    code: `const MenuList = forwardRef(({ onClose, ...props }, ref) => {
              const onLogout = useCallback(() => {
                onClose()
              }, [onClose])

              return (
                <BlnMenuList ref={ref} {...props}>
                  <BlnMenuItem key="logout" onClick={onLogout}>
                    Logout
                  </BlnMenuItem>
                </BlnMenuList>
              )
            })

            MenuList.displayName = 'MenuList'

            MenuList.propTypes = {
              onClose: PropTypes.func
            }

            MenuList.defaultProps = {
              onClose: () => null
            }

            export default MenuList`,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `function Hello(props) {
            return <div>Hello {props.name}</div>;
          }
          function HelloAgain(props) {
            return <div>Hello again {props.name}</div>;
          }`,
  },
  {
    code: `function Hello(props) {
              return <div>Hello {props.name}</div>;
            }
            class HelloJohn extends React.Component {
              render() {
                return <Hello name="John" />;
              }
            }`,
  },
  {
    code: `export default {
            RenderHello(props) {
              let {name} = props;
              return <div>{name}</div>;
            },
            RenderHello2(props) {
              let {name} = props;
              return <div>{name}</div>;
            }
          };`,
  },
  {
    code: `exports.Foo = function Foo() {
            return <></>
          }

          exports.createSomeComponent = function createSomeComponent(opts) {
            return function Foo() {
              return <>{opts.a}</>
            }
          }`,
  },
  {
    code: `class StoreListItem extends React.PureComponent {
            // A bunch of stuff here
          }
            export default React.forwardRef((props, ref) => <div><StoreListItem {...props} forwardRef={ref} /></div>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const HelloComponent = (props) => {
            return <div></div>;
          }
          const HelloComponent2 = React.forwardRef((props, ref) => <div></div>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = React.forwardRef((props, ref) => <><HelloComponent></HelloComponent></>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const forwardRef = React.forwardRef;
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = forwardRef((props, ref) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const memo = React.memo;
          const HelloComponent = (props) => {
            return <div></div>;
          };
          const HelloComponent2 = memo((props) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const {forwardRef} = React;
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = forwardRef((props, ref) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const {memo} = React;
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = memo((props) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `import React, { memo } from 'react';
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = memo((props) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `import {forwardRef} from 'react';
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = forwardRef((props, ref) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const { memo } = require('react');
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = memo((props) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const {forwardRef} = require('react');
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = forwardRef((props, ref) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const forwardRef = require('react').forwardRef;
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = forwardRef((props, ref) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `const memo = require('react').memo;
          const HelloComponent = (0, (props) => {
            return <div></div>;
          });
          const HelloComponent2 = memo((props) => <HelloComponent></HelloComponent>);`,
    oxcOptions: [{ ignoreStateless: false }],
  },
  {
    code: `import { PureComponent } from 'react';
          class Foo extends PureComponent {
            render() { return <div/>; }
          }
          class Bar extends PureComponent {
            render() { return <span/>; }
          }`,
  },
  {
    code: `export const Foo = () => { return null; }
          export const Bar = () => { return null; }`,
  },
  {
    code: `export const Foo = () => null;
          export const Bar = () => null;`,
  },
];
