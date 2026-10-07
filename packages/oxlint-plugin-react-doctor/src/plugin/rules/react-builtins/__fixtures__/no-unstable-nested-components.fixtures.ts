// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_unstable_nested_components.rs`
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
                    function ParentComponent() {
                      return (
                        <div>
                          <OutsideDefinedFunctionComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(OutsideDefinedFunctionComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent
                          footer={<OutsideDefinedComponent />}
                          header={<div />}
                          />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return React.createElement(SomeComponent, {
                        footer: React.createElement(OutsideDefinedComponent, null),
                        header: React.createElement("div", null)
                      });
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const MemoizedNestedComponent = React.useCallback(() => <div />, []);
            
                      return (
                        <div>
                          <MemoizedNestedComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const MemoizedNestedComponent = React.useCallback(
                        () => React.createElement("div", null),
                        []
                      );
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(MemoizedNestedComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const MemoizedNestedFunctionComponent = React.useCallback(
                        function () {
                          return <div />;
                        },
                        []
                      );
            
                      return (
                        <div>
                          <MemoizedNestedFunctionComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const MemoizedNestedFunctionComponent = React.useCallback(
                        function () {
                          return React.createElement("div", null);
                        },
                        []
                      );
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(MemoizedNestedFunctionComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      // Should not interfere handler declarations
                      function onClick(event) {
                        props.onClick(event.target.value);
                      }
            
                      const onKeyPress = () => null;
            
                      function getOnHover() {
                        return function onHover(event) {
                          props.onHover(event.target);
                        }
                      }
            
                      return (
                        <div>
                          <button
                            onClick={onClick}
                            onKeyPress={onKeyPress}
                            onHover={getOnHover()}
            
                            // These should not be considered as components
                            maybeComponentOrHandlerNull={() => null}
                            maybeComponentOrHandlerUndefined={() => undefined}
                            maybeComponentOrHandlerBlank={() => ''}
                            maybeComponentOrHandlerString={() => 'hello-world'}
                            maybeComponentOrHandlerNumber={() => 42}
                            maybeComponentOrHandlerArray={() => []}
                            maybeComponentOrHandlerObject={() => {}} />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      function getComponent() {
                        return <div />;
                      }
            
                      return (
                        <div>
                          {getComponent()}
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      function getComponent() {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement("div", null, getComponent());
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                        return (
                          <RenderPropComponent>
                            {() => <div />}
                          </RenderPropComponent>
                        );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                        return (
                          <RenderPropComponent children={() => <div />} />
                        );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <ComplexRenderPropComponent
                          listRenderer={data.map((items, index) => (
                            <ul>
                              {items[index].map((item) =>
                                <li>
                                  {item}
                                </li>
                              )}
                            </ul>
                          ))
                          }
                        />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return React.createElement(
                          RenderPropComponent,
                          null,
                          () => React.createElement("div", null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      return (
                        <ul>
                          {props.items.map(item => (
                            <li key={item.id}>
                              {item.name}
                            </li>
                          ))}
                        </ul>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      return (
                        <List items={props.items.map(item => {
                          return (
                            <li key={item.id}>
                              {item.name}
                            </li>
                          );
                        })}
                        />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      return React.createElement(
                        "ul",
                        null,
                        props.items.map(() =>
                          React.createElement(
                            "li",
                            { key: item.id },
                            item.name
                          )
                        )
                      )
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      return (
                        <ul>
                          {props.items.map(function Item(item) {
                            return (
                              <li key={item.id}>
                                {item.name}
                              </li>
                            );
                          })}
                        </ul>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent(props) {
                      return React.createElement(
                        "ul",
                        null,
                        props.items.map(function Item() {
                          return React.createElement(
                            "li",
                            { key: item.id },
                            item.name
                          );
                        })
                      );
                    }
                  `,
  },
  {
    code: `
                    function createTestComponent(props) {
                      return (
                        <div />
                      );
                    }
                  `,
  },
  {
    code: `
                    function createTestComponent(props) {
                      return React.createElement("div", null);
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <ComponentWithProps footer={() => <div />} />
                      );
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                    function ParentComponent() {
                      return React.createElement(ComponentWithProps, {
                        footer: () => React.createElement("div", null)
                      });
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent item={{ children: () => <div /> }} />
                      )
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                  function ParentComponent() {
                    return (
                      <SomeComponent>
                        {
                          thing.match({
                            renderLoading: () => <div />,
                            renderSuccess: () => <div />,
                            renderFailure: () => <div />,
                          })
                        }
                      </SomeComponent>
                    )
                  }
                  `,
  },
  {
    code: `
                  function ParentComponent() {
                    const thingElement = thing.match({
                      renderLoading: () => <div />,
                      renderSuccess: () => <div />,
                      renderFailure: () => <div />,
                    });
                    return (
                      <SomeComponent>
                        {thingElement}
                      </SomeComponent>
                    )
                  }
                  `,
  },
  {
    code: `
                  function ParentComponent() {
                    return (
                      <SomeComponent>
                        {
                          thing.match({
                            loading: () => <div />,
                            success: () => <div />,
                            failure: () => <div />,
                          })
                        }
                      </SomeComponent>
                    )
                  }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                  function ParentComponent() {
                    const thingElement = thing.match({
                      loading: () => <div />,
                      success: () => <div />,
                      failure: () => <div />,
                    });
                    return (
                      <SomeComponent>
                        {thingElement}
                      </SomeComponent>
                    )
                  }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <ComponentForProps renderFooter={() => <div />} />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return React.createElement(ComponentForProps, {
                        renderFooter: () => React.createElement("div", null)
                      });
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      useEffect(() => {
                        return () => null;
                      });
            
                      return <div />;
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent renderers={{ Header: () => <div /> }} />
                      )
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent renderMenu={() => (
                          <RenderPropComponent>
                            {items.map(item => (
                              <li key={item}>{item}</li>
                            ))}
                          </RenderPropComponent>
                        )} />
                      )
                    }
                  `,
  },
  {
    code: `
                    const ParentComponent = () => (
                      <SomeComponent
                        components={[
                          <ul>
                            {list.map(item => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>,
                        ]}
                      />
                    );
                 `,
  },
  {
    code: `
                    function ParentComponent() {
                      const rows = [
                        {
                          name: 'A',
                          render: (props) => <Row {...props} />
                        },
                      ];
            
                      return <Table rows={rows} />;
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return <SomeComponent renderers={{ notComponent: () => null }} />;
                    }
                  `,
  },
  {
    code: `
                    const ParentComponent = createReactClass({
                      displayName: "ParentComponent",
                      statics: {
                        getSnapshotBeforeUpdate: function () {
                          return null;
                        },
                      },
                      render() {
                        return <div />;
                      },
                    });
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const rows = [
                        {
                          name: 'A',
                          notPrefixedWithRender: (props) => <Row {...props} />
                        },
                      ];
            
                      return <Table rows={rows} />;
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                    function ParentComponent() {
                      return <Table
                        rowRenderer={(rowData) => <Row data={data} />}
                      />
                    }
                  `,
    oxcOptions: [{ propNamePattern: "*Renderer" }],
  },
  {
    code: `
                    function ParentComponent() {
                      return <SomeComponent footer={React.memo(() => <div />)} />;
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent
                          footer={class Footer extends React.Component {
                            render() {
                              return <div />;
                            }
                          }}
                        />
                      );
                    }
                  `,
    oxcOptions: [{ allowAsProps: true }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    function ParentComponent() {
                      function UnstableNestedFunctionComponent() {
                        return <div />;
                      }
            
                      return (
                        <div>
                          <UnstableNestedFunctionComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      function UnstableNestedFunctionComponent() {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedFunctionComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedVariableComponent = () => {
                        return <div />;
                      }
            
                      return (
                        <div>
                          <UnstableNestedVariableComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedVariableComponent = () => {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedVariableComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    const ParentComponent = () => {
                      function UnstableNestedFunctionComponent() {
                        return <div />;
                      }
            
                      return (
                        <div>
                          <UnstableNestedFunctionComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    const ParentComponent = () => {
                      function UnstableNestedFunctionComponent() {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedFunctionComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    export default () => {
                      function UnstableNestedFunctionComponent() {
                        return <div />;
                      }
            
                      return (
                        <div>
                          <UnstableNestedFunctionComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    export default () => {
                      function UnstableNestedFunctionComponent() {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedFunctionComponent, null)
                      );
                    };
                  `,
  },
  {
    code: `
                    const ParentComponent = () => {
                      const UnstableNestedVariableComponent = () => {
                        return <div />;
                      }
            
                      return (
                        <div>
                          <UnstableNestedVariableComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    const ParentComponent = () => {
                      const UnstableNestedVariableComponent = () => {
                        return React.createElement("div", null);
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedVariableComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      class UnstableNestedClassComponent extends React.Component {
                        render() {
                          return <div />;
                        }
                      };
            
                      return (
                        <div>
                          <UnstableNestedClassComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      class UnstableNestedClassComponent extends React.Component {
                        render() {
                          return React.createElement("div", null);
                        }
                      }
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedClassComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        class UnstableNestedClassComponent extends React.Component {
                          render() {
                            return <div />;
                          }
                        };
            
                        return (
                          <div>
                            <UnstableNestedClassComponent />
                          </div>
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        class UnstableNestedClassComponent extends React.Component {
                          render() {
                            return React.createElement("div", null);
                          }
                        }
            
                        return React.createElement(
                          "div",
                          null,
                          React.createElement(UnstableNestedClassComponent, null)
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        function UnstableNestedFunctionComponent() {
                          return <div />;
                        }
            
                        return (
                          <div>
                            <UnstableNestedFunctionComponent />
                          </div>
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        function UnstableNestedClassComponent() {
                          return React.createElement("div", null);
                        }
            
                        return React.createElement(
                          "div",
                          null,
                          React.createElement(UnstableNestedClassComponent, null)
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        const UnstableNestedVariableComponent = () => {
                          return <div />;
                        }
            
                        return (
                          <div>
                            <UnstableNestedVariableComponent />
                          </div>
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        const UnstableNestedClassComponent = () => {
                          return React.createElement("div", null);
                        }
            
                        return React.createElement(
                          "div",
                          null,
                          React.createElement(UnstableNestedClassComponent, null)
                        );
                      }
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      function getComponent() {
                        function NestedUnstableFunctionComponent() {
                          return <div />;
                        };
            
                        return <NestedUnstableFunctionComponent />;
                      }
            
                      return (
                        <div>
                          {getComponent()}
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      function getComponent() {
                        function NestedUnstableFunctionComponent() {
                          return React.createElement("div", null);
                        }
            
                        return React.createElement(NestedUnstableFunctionComponent, null);
                      }
            
                      return React.createElement("div", null, getComponent());
                    }
                  `,
  },
  {
    code: `
                    function ComponentWithProps(props) {
                      return <div />;
                    }
            
                    function ParentComponent() {
                      return (
                        <ComponentWithProps
                          footer={
                            function SomeFooter() {
                              return <div />;
                            }
                          } />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ComponentWithProps(props) {
                      return React.createElement("div", null);
                    }
            
                    function ParentComponent() {
                      return React.createElement(ComponentWithProps, {
                        footer: function SomeFooter() {
                          return React.createElement("div", null);
                        }
                      });
                    }
                  `,
  },
  {
    code: `
                    function ComponentWithProps(props) {
                      return <div />;
                    }
            
                    function ParentComponent() {
                        return (
                          <ComponentWithProps footer={() => <div />} />
                        );
                    }
                  `,
  },
  {
    code: `
                    function ComponentWithProps(props) {
                      return React.createElement("div", null);
                    }
            
                    function ParentComponent() {
                      return React.createElement(ComponentWithProps, {
                        footer: () => React.createElement("div", null)
                      });
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                        return (
                          <RenderPropComponent>
                            {() => {
                              function UnstableNestedComponent() {
                                return <div />;
                              }
            
                              return (
                                <div>
                                  <UnstableNestedComponent />
                                </div>
                              );
                            }}
                          </RenderPropComponent>
                        );
                    }
                  `,
  },
  {
    code: `
                    function RenderPropComponent(props) {
                      return props.render({});
                    }
            
                    function ParentComponent() {
                      return React.createElement(
                        RenderPropComponent,
                        null,
                        () => {
                          function UnstableNestedComponent() {
                            return React.createElement("div", null);
                          }
            
                          return React.createElement(
                            "div",
                            null,
                            React.createElement(UnstableNestedComponent, null)
                          );
                        }
                      );
                    }
                  `,
  },
  {
    code: `
                    function ComponentForProps(props) {
                      return <div />;
                    }
            
                    function ParentComponent() {
                      return (
                        <ComponentForProps notPrefixedWithRender={() => <div />} />
                      );
                    }
                  `,
  },
  {
    code: `
                    function ComponentForProps(props) {
                      return React.createElement("div", null);
                    }
            
                    function ParentComponent() {
                      return React.createElement(ComponentForProps, {
                        notPrefixedWithRender: () => React.createElement("div", null)
                      });
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <ComponentForProps someMap={{ Header: () => <div /> }} />
                      );
                    }
                  `,
  },
  {
    code: `
                    class ParentComponent extends React.Component {
                      render() {
                        const List = (props) => {
                          const items = props.items
                            .map((item) => (
                              <li key={item.key}>
                                <span>{item.name}</span>
                              </li>
                            ));
            
                          return <ul>{items}</ul>;
                        };
            
                        return <List {...this.props} />;
                      }
                    }
                  `,
  },
  {
    code: `
                  function ParentComponent() {
                    return (
                      <SomeComponent>
                        {
                          thing.match({
                            loading: () => <div />,
                            success: () => <div />,
                            failure: () => <div />,
                          })
                        }
                      </SomeComponent>
                    )
                  }
                  `,
  },
  {
    code: `
                  function ParentComponent() {
                    const thingElement = thing.match({
                      loading: () => <div />,
                      success: () => <div />,
                      failure: () => <div />,
                    });
                    return (
                      <SomeComponent>
                        {thingElement}
                      </SomeComponent>
                    )
                  }
                  `,
  },
  {
    code: `
                  function ParentComponent() {
                    const rows = [
                      {
                        name: 'A',
                        notPrefixedWithRender: (props) => <Row {...props} />
                      },
                    ];
            
                    return <Table rows={rows} />;
                  }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedComponent = React.memo(() => {
                        return <div />;
                      });
            
                      return (
                        <div>
                          <UnstableNestedComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedComponent = React.memo(
                        () => React.createElement("div", null),
                      );
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedComponent = React.memo(
                        function () {
                          return <div />;
                        }
                      );
            
                      return (
                        <div>
                          <UnstableNestedComponent />
                        </div>
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedComponent = React.memo(
                        function () {
                          return React.createElement("div", null);
                        }
                      );
            
                      return React.createElement(
                        "div",
                        null,
                        React.createElement(UnstableNestedComponent, null)
                      );
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      NestedComponent = () => <div />;
                      return <NestedComponent />;
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      const UnstableNestedComponent = React.memo(React.forwardRef(() => <div />));
                      return <UnstableNestedComponent />;
                    }
                  `,
  },
  {
    code: `
                    export default React.forwardRef(function ParentComponent() {
                      const UnstableNestedComponent = () => <div />;
                      return <UnstableNestedComponent />;
                    });
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return <SomeComponent footer={React.memo(() => <div />)} />;
                    }
                  `,
  },
  {
    code: `
                    function ParentComponent() {
                      return (
                        <SomeComponent
                          footer={class Footer extends React.Component {
                            render() {
                              return <div />;
                            }
                          }}
                        />
                      );
                    }
                  `,
  },
];
