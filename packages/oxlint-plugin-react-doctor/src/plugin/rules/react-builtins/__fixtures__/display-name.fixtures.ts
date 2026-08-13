// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/display_name.rs`
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
  { code: `const createHandler = () => () => { someGlobalFunc(<div />); };` },
  {
    code: `
                    var Hello = createReactClass({
                      displayName: 'Hello',
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = React.createClass({
                      displayName: 'Hello',
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
    oxcSettings: { settings: { react: { createClass: "createClass" } } },
  },
  {
    code: `
                    class Hello extends React.Component {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                    Hello.displayName = 'Hello'
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    export default class Hello extends React.Component {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                    Hello.displayName = 'Hello'
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    class Hello {
                      render() {
                        return 'Hello World';
                      }
                    }
                  `,
  },
  {
    code: `
                    class Hello extends Greetings {
                      static text = 'Hello World';
                      render() {
                        return Hello.text;
                      }
                    }
                  `,
  },
  {
    code: `
                    class Hello {
                      method;
                    }
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      static get displayName() {
                        return 'Hello';
                      }
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    class Hello extends React.Component {
                      static displayName = 'Widget';
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    export default class Hello {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    export default class Logo extends React.Component<Props> {
                      public render(): React.ReactNode {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    var Hello;
                    Hello = createReactClass({
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    module.exports = createReactClass({
                      "displayName": "Hello",
                      "render": function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      displayName: 'Hello',
                      render: function() {
                        let { a, ...b } = obj;
                        let c = { ...d };
                        return <div />;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    export default class {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    export const Hello = React.memo(function Hello() {
                      return <p />;
                    })
                  `,
  },
  {
    code: `
                    var Hello = function() {
                      return <div>Hello {this.props.name}</div>;
                    }
                  `,
  },
  {
    code: `
                    function Hello() {
                      return <div>Hello {this.props.name}</div>;
                    }
                  `,
  },
  {
    code: `
                    var Hello = () => {
                      return <div>Hello {this.props.name}</div>;
                    }
                  `,
  },
  {
    code: `
                    module.exports = function Hello() {
                      return <div>Hello {this.props.name}</div>;
                    }
                  `,
  },
  {
    code: `
                    function Hello() {
                      return <div>Hello {this.props.name}</div>;
                    }
                    Hello.displayName = 'Hello';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = () => {
                      return <div>Hello {this.props.name}</div>;
                    }
                    Hello.displayName = 'Hello';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = function() {
                      return <div>Hello {this.props.name}</div>;
                    }
                    Hello.displayName = 'Hello';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Mixins = {
                      Greetings: {
                        Hello: function() {
                          return <div>Hello {this.props.name}</div>;
                        }
                      }
                    }
                    Mixins.Greetings.Hello.displayName = 'Hello';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return <div>{this._renderHello()}</div>;
                      },
                      _renderHello: function() {
                        return <span>Hello {this.props.name}</span>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      displayName: 'Hello',
                      render: function() {
                        return <div>{this._renderHello()}</div>;
                      },
                      _renderHello: function() {
                        return <span>Hello {this.props.name}</span>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    const Mixin = {
                      Button() {
                        return (
                          <button />
                        );
                      }
                    };
                  `,
  },
  {
    code: `
                    var obj = {
                      pouf: function() {
                        return any
                      }
                    };
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var obj = {
                      pouf: function() {
                        return any
                      }
                    };
                  `,
  },
  {
    code: `
                    export default {
                      renderHello() {
                        let {name} = this.props;
                        return <div>{name}</div>;
                      }
                    };
                  `,
  },
  {
    code: `
                    import React, { createClass } from 'react';
                    export default createClass({
                      displayName: 'Foo',
                      render() {
                        return <h1>foo</h1>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
    oxcSettings: { settings: { react: { createClass: "createClass" } } },
  },
  {
    code: `
                    import React, {Component} from "react";
                    function someDecorator(ComposedComponent) {
                      return class MyDecorator extends Component {
                        render() {return <ComposedComponent {...this.props} />;}
                      };
                    }
                    module.exports = someDecorator;
                  `,
  },
  {
    code: `
                    import React, {createElement} from "react";
                    const SomeComponent = (props) => {
                      const {foo, bar} = props;
                      return someComponentFactory({
                        onClick: () => foo(bar("x"))
                      });
                    };
                  `,
  },
  {
    code: `
                    const element = (
                      <Media query={query} render={() => {
                        renderWasCalled = true
                        return <div/>
                      }}/>
                    )
                  `,
  },
  {
    code: `
                    const element = (
                      <Media query={query} render={function() {
                        renderWasCalled = true
                        return <div/>
                      }}/>
                    )
                  `,
  },
  {
    code: `
                    module.exports = {
                      createElement: tagName => document.createElement(tagName)
                    };
                  `,
  },
  {
    code: `
                    const { createElement } = document;
                    createElement("a");
                  `,
  },
  {
    code: `
                    import React from 'react'
                    import { string } from 'prop-types'

                    function Component({ world }) {
                      return <div>Hello {world}</div>
                    }

                    Component.propTypes = {
                      world: string,
                    }

                    export default React.memo(Component)
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ComponentWithMemo = React.memo(function Component({ world }) {
                      return <div>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const Hello = React.memo(function Hello() {
                      return;
                    });
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ForwardRefComponentLike = React.forwardRef(function ComponentLike({ world }, ref) {
                      return <div ref={ref}>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    function F() {
                      let items = [];
                      let testData = [
                        {a: "test1", displayName: "test2"}, {a: "test1", displayName: "test2"}];
                      for (let item of testData) {
                          items.push({a: item.a, b: item.displayName});
                      }
                      return <div>{items}</div>;
                    }
                  `,
  },
  {
    code: `
                    const renderer = a => function Component(listItem) {
                      return <div>{a} {listItem}</div>;
                    };
                  `,
  },
  {
    code: `
                    const Comp = React.forwardRef((props, ref) => <main />);
                    Comp.displayName = 'MyCompName';
                  `,
  },
  {
    code: `
                    const Comp = React.forwardRef((props, ref) => <main data-as="yes" />) as SomeComponent;
                    Comp.displayName = 'MyCompNameAs';
                  `,
  },
  {
    code: `
                    function Test() {
                      const data = [
                        {
                          name: 'Bob',
                        },
                      ];

                      const columns = [
                        {
                          Header: 'Name',
                          accessor: 'name',
                          Cell: ({ value }) => <div>{value}</div>,
                        },
                      ];

                      return <ReactTable columns={columns} data={data} />;
                    }
                  `,
  },
  {
    code: `
                    const f = (a) => () => {
                      if (a) {
                        return null;
                      }
                      return 1;
                    };
                  `,
  },
  {
    code: `
                    class Test {
                      render() {
                        const data = [
                          {
                            name: 'Bob',
                            Cell: ({ value }) => <div>{value}</div>,
                          },
                        ];

                        return <ReactTable columns={columns} data={data} />;
                      }
                    }
                  `,
  },
  {
    code: `
                    export const demo = (a) => (b) => {
                      if (a == null) return null;
                      return b;
                    }
                  `,
  },
  {
    code: `
                    let demo = null;
                    demo = (a) => {
                      if (a == null) return null;
                      return f(a);
                    };`,
  },
  {
    code: `
                    obj._property = (a) => {
                      if (a == null) return null;
                      return f(a);
                    };
                  `,
  },
  {
    code: `
                    _variable = (a) => {
                      if (a == null) return null;
                      return f(a);
                    };
                  `,
  },
  {
    code: `
                    demo = () => () => null;
                  `,
  },
  {
    code: `
                    demo = {
                      property: () => () => null
                    }
                  `,
  },
  {
    code: `
                    demo = function() {return function() {return null;};};
                  `,
  },
  {
    code: `
                    demo = {
                      property: function() {return function() {return null;};}
                    }
                  `,
  },
  {
    code: `
                    function MyComponent(props) {
                      return <b>{props.name}</b>;
                    }

                    const MemoizedMyComponent = React.memo(
                      MyComponent,
                      (prevProps, nextProps) => prevProps.name === nextProps.name
                    )
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(function({ world }, ref) {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "16.14.0" } } },
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(({ world }, ref) => {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "15.7.0" } } },
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(function ComponentLike({ world }, ref) {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "16.12.1" } } },
  },
  {
    code: `
                    export const ComponentWithForwardRef = React.memo(
                      React.forwardRef(function Component({ world }) {
                        return <div>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "0.14.11" } } },
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(function({ world }, ref) {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "15.7.1" } } },
  },
  {
    code: `
                    import React from 'react';

                    const Hello = React.createContext();
                    Hello.displayName = "HelloContext"
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();
                    Hello.displayName = "HelloContext"
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();

                    const obj = {};
                    obj.displayName = "False positive";

                    Hello.displayName = "HelloContext"
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import * as React from 'react';

                    const Hello = React.createContext();

                    const obj = {};
                    obj.displayName = "False positive";

                    Hello.displayName = "HelloContext";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    const obj = {};
                    obj.displayName = "False positive";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
    oxcSettings: { settings: { react: { version: "16.2.0" } } },
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();
                    Hello.displayName = "HelloContext";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
                    import { createContext } from 'react';

                    let Hello;
                    Hello = createContext();
                    Hello.displayName = "HelloContext";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();
                  `,
    oxcOptions: [{ checkContextObjects: false }],
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
                    import { createContext } from 'react';

                    var Hello;
                    Hello = createContext();
                    Hello.displayName = "HelloContext";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    var Hello;
                    Hello = React.createContext();
                    Hello.displayName = "HelloContext";
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    export default function Hello() {
                      return <div>Hello {this.props.name}</div>;
                    }
                    Hello.displayName = 'Hello';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    export default function Testing() {
                      const renderThing = () => <div>Thing</div>;
                      return <div>{renderThing()}</div>;
                    }
                    Testing.displayName = 'Testing';
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `export default () => { const view = <div/>; return view; };` },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return React.createElement("div", {}, "text content");
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = React.createClass({
                      render: function() {
                        return React.createElement("div", {}, "text content");
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
    oxcSettings: { settings: { react: { createClass: "createClass" } } },
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    class Hello extends React.Component {
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    module.exports = function() {
                      return <div>Hello {props.name}</div>;
                    }
                  `,
  },
  {
    code: `
                    module.exports = createReactClass({
                      render() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      _renderHello: function() {
                        return <span>Hello {this.props.name}</span>;
                      },
                      render: function() {
                        return <div>{this._renderHello()}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    var Hello = Foo.createClass({
                      _renderHello: function() {
                        return <span>Hello {this.props.name}</span>;
                      },
                      render: function() {
                        return <div>{this._renderHello()}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
    oxcSettings: { settings: { react: { pragma: "Foo", createClass: "createClass" } } },
  },
  {
    code: `
                    /** @jsx Foo */
                    var Hello = Foo.createClass({
                      _renderHello: function() {
                        return <span>Hello {this.props.name}</span>;
                      },
                      render: function() {
                        return <div>{this._renderHello()}</div>;
                      }
                    });
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
    oxcSettings: { settings: { react: { createClass: "createClass" } } },
  },
  {
    code: `
                    const Mixin = {
                      Button() {
                        return (
                          <button />
                        );
                      }
                    };
                  `,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
  {
    code: `
                    function Hof() {
                      return function () {
                        return <div />
                      }
                    }
                  `,
  },
  {
    code: `
                    import React, { createElement } from "react";
                    export default (props) => {
                      return createElement("div", {}, "hello");
                    };
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ComponentWithMemo = React.memo(({ world }) => {
                      return <div>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ComponentWithMemo = React.memo(function() {
                      return <div>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ForwardRefComponentLike = React.forwardRef(({ world }, ref) => {
                      return <div ref={ref}>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const ForwardRefComponentLike = React.forwardRef(function({ world }, ref) {
                      return <div ref={ref}>Hello {world}</div>
                    })
                  `,
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(({ world }, ref) => {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "15.6.0" } } },
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(function({ world }, ref) {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "0.14.2" } } },
  },
  {
    code: `
                    import React from 'react'

                    const MemoizedForwardRefComponentLike = React.memo(
                      React.forwardRef(function ComponentLike({ world }, ref) {
                        return <div ref={ref}>Hello {world}</div>
                      })
                    )
                  `,
    oxcSettings: { settings: { react: { version: "15.0.1" } } },
  },
  {
    code: `
                    import React from "react";
                    const { createElement } = React;
                    export default (props) => {
                      return createElement("div", {}, "hello");
                    };
                  `,
  },
  {
    code: `
                    import React from "react";
                    const createElement = React.createElement;
                    export default (props) => {
                      return createElement("div", {}, "hello");
                    };
                  `,
  },
  {
    code: `
                    module.exports = function () {
                      function a () {}
                      const b = function b () {}
                      const c = function () {}
                      const d = () => {}
                      const obj = {
                        a: function a () {},
                        b: function b () {},
                        c () {},
                        d: () => {},
                      }
                      return React.createElement("div", {}, "text content");
                    }
                  `,
  },
  {
    code: `
                    module.exports = () => {
                      function a () {}
                      const b = function b () {}
                      const c = function () {}
                      const d = () => {}
                      const obj = {
                        a: function a () {},
                        b: function b () {},
                        c () {},
                        d: () => {},
                      }

                      return React.createElement("div", {}, "text content");
                    }
                  `,
  },
  {
    code: `
                    export default class extends React.Component {
                      render() {
                        function a () {}
                        const b = function b () {}
                        const c = function () {}
                        const d = () => {}
                        const obj = {
                          a: function a () {},
                          b: function b () {},
                          c () {},
                          d: () => {},
                        }
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    export default class extends React.PureComponent {
                      render() {
                        return <Card />;
                      }
                    }

                    const Card = (() => {
                      return React.memo(({ }) => (
                        <div />
                      ));
                    })();
                  `,
  },
  {
    code: `
                    const renderer = a => listItem => (
                      <div>{a} {listItem}</div>
                    );
                  `,
  },
  {
    code: `
                    const processData = (options?: { value: string }) => options?.value || 'no data';

                    export const Component = observer(() => {
                      const data = processData({ value: 'data' });
                      return <div>{data}</div>;
                    });

                    export const Component2 = observer(() => {
                      const data = processData();
                      return <div>{data}</div>;
                    });
                  `,
    oxcSettings: { settings: { react: { componentWrapperFunctions: ["observer"] } } },
  },
  {
    code: `
                    import React from 'react';

                    const Hello = React.createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import * as React from 'react';

                    const Hello = React.createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    const Hello = createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    interface PostHogGroupContext {
                      value: string;
                    }

                    const PostHogGroupContext = createContext<PostHogGroupContext | null>(null);
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    var Hello;
                    Hello = createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `
                    import { createContext } from 'react';

                    var Hello;
                    Hello = React.createContext();
                  `,
    oxcOptions: [{ checkContextObjects: true }],
  },
  {
    code: `export default function Hello() {
  return <div>Hello {this.props.name}</div>;
}`,
    oxcOptions: [{ ignoreTranspilerName: true }],
  },
];
