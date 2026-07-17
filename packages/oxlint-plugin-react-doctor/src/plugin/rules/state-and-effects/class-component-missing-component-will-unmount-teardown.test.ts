import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

describe("class-component-missing-component-will-unmount-teardown", () => {
  it("flags a componentDidMount that registers a listener on a new instance", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Legend extends React.Component {
        componentDidMount() {
          this.network = new Network(this.container, data, options);
          this.network.on("beforeDrawing", (ctx) => this.draw(ctx));
        }
        render() { return null; }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags addEventListener in componentDidMount with no teardown", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends Component {
        componentDidMount() {
          window.addEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags setInterval in componentDidMount unconditionally", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Clock extends React.PureComponent {
        componentDidMount() {
          setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags setTimeout whose callback calls this.setState", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          setTimeout(() => this.setState({ ready: true }), 500);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags setTimeout whose callback invokes a local helper that calls this.setState", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class App extends React.Component {
        componentDidMount() {
          setTimeout(() => {
            const updateReady = () => this.setState({ ready: true });
            updateReady();
          }, 500);
        }
        render() { return <div />; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags setTimeout whose callback invokes an aliased local state helper", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class App extends React.Component {
        componentDidMount() {
          setTimeout(() => {
            const updateReady = () => this.setState({ ready: true });
            const runUpdate = updateReady;
            runUpdate();
          }, 500);
        }
        render() { return <div />; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a subscribe registration in the constructor", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        constructor(props) {
          super(props);
          this.store = createStore();
          this.store.subscribe(() => this.forceUpdate());
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a setTimeout that only assigns a plain instance field", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class ProductModal extends React.Component {
        componentDidMount() {
          setTimeout(() => (this.readyToHide = true), 500);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setTimeout that only nudges focus via a ref", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          setTimeout(() => this.inputRef.current?.focus());
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the class declares componentWillUnmount", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          window.addEventListener("resize", this.handleResize);
        }
        componentWillUnmount() {
          window.removeEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes quoted and computed lifecycle method names", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class QuotedCleanup extends React.Component {
         "componentDidMount"() {
           window.addEventListener("resize", this.handleResize);
         }
         ["componentWillUnmount"]() {
           window.removeEventListener("resize", this.handleResize);
         }
         render() { return null; }
       }
       class ComputedMount extends React.Component {
         ["componentDidMount"] = () => {
           window.addEventListener("scroll", this.handleScroll);
         };
         render() { return null; }
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the class uses disposeOnUnmount", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      import { disposeOnUnmount } from "mobx-react";
      class C extends React.Component {
        componentDidMount() {
          disposeOnUnmount(this, reaction(() => this.value, () => {}));
          window.addEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a pure data-fetch mount with no resource to release", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          fetch("/api/data").then((r) => this.setState({ data: r }));
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a new instance with no listener registration", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          this.formatter = new Intl.NumberFormat("en-US");
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags window.setInterval in componentDidMount (TS number-timer-id idiom)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Clock extends React.Component {
        componentDidMount() {
          this.timer = window.setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags addListener on a module-scope emitter (React Native Keyboard idiom)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          this.subscription = Keyboard.addListener("keyboardDidShow", this.onShow);
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a listener on a local emitter that escapes onto this", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Legend extends React.Component {
        componentDidMount() {
          const network = new Network(this.container, data, options);
          network.on("beforeDrawing", (ctx) => this.draw(ctx));
          this.network = network;
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a listener on an emitter constructed locally in the mount body (Algolia places idiom)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          const autocomplete = places({ container: this.input });
          autocomplete.on("change", (event) => this.props.onChange(event.suggestion));
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the lodash _.once function-factory idiom in a constructor", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        constructor(props) {
          super(props);
          this.trackFirstOpen = _.once(() => trackEvent("open"));
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a self-removing addEventListener with { once: true }", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          window.addEventListener("load", this.onLoad, { once: true });
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a static computed once option key", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          window.addEventListener("load", this.onLoad, { [\`once\`]: true });
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a listener on a ref-owned DOM node (dies with the component)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          this.containerRef.current.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() {
          return <div ref={this.containerRef} />;
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain (non-React) class that registers a listener", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Store {
        componentDidMount() {
          this.emitter.on("change", this.handle);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: setTimeout deferring a focus nudge through a named instance method", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class SearchModal extends React.Component {
  inputRef = React.createRef();
  focusInput = () => {
    this.inputRef.current?.focus();
  };
  componentDidMount() {
    setTimeout(() => this.focusInput(), 0);
  }
  render() {
    return <input ref={this.inputRef} />;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: setTimeout deferring scroll-to-bottom through an instance method (chat UI)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class MessageList extends React.Component {
  bottomRef = React.createRef();
  scrollToBottom = () => {
    this.bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  componentDidMount() {
    setTimeout(() => this.scrollToBottom(), 0);
  }
  render() {
    return <div ref={this.bottomRef} />;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: d3 fluent chain binding DOM events inside the component's own svg", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class BarChart extends React.Component {
  svgRef = React.createRef();
  componentDidMount() {
    d3.select(this.svgRef.current)
      .selectAll("rect")
      .data(this.props.data)
      .enter()
      .append("rect")
      .on("mouseover", (event, datum) => this.props.onBarHover(datum));
  }
  render() {
    return <svg ref={this.svgRef} />;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Destructured mount-local emitter that never escapes", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class AddressField extends React.Component {
  componentDidMount() {
    const { autocomplete } = initPlaces({ container: this.input });
    autocomplete.on("change", (event) => this.props.onChange(event.suggestion));
  }
  render() {
    return null;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Listener added and synchronously removed in the same mount body (passive-support detection)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class ScrollArea extends React.Component {
  noop = () => {};
  componentDidMount() {
    let supportsPassive = false;
    try {
      const options = Object.defineProperty({}, "passive", {
        get() {
          supportsPassive = true;
          return true;
        },
      });
      window.addEventListener("test-passive", this.noop, options);
      window.removeEventListener("test-passive", this.noop, options);
    } catch (error) {}
    this.supportsPassive = supportsPassive;
  }
  render() {
    return null;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a listener is synchronously removed with the same static template event", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class ScrollArea extends React.Component {
        noop = () => {};
        componentDidMount() {
          window.addEventListener(\`resize\`, this.noop);
          window.removeEventListener(\`resize\`, this.noop);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags mismatched capture values when the registration key is statically computed", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class ScrollArea extends React.Component {
        noop = () => {};
        componentDidMount() {
          window.addEventListener("resize", this.noop, { [\`capture\`]: true });
          window.removeEventListener("resize", this.noop, { capture: false });
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Self-removing { once: true } listener whose options object lives in a variable", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class SplashScreen extends React.Component {
  reveal = () => this.setState({ visible: true });
  componentDidMount() {
    const listenerOptions = { once: true };
    window.addEventListener("animationend", this.reveal, listenerOptions);
  }
  render() {
    return null;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags listeners registered through nested mount-local helpers invoked synchronously (cboard connection-status idiom)", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class AppContainer extends Component {
        componentDidMount() {
          const configureConnectionStatus = () => {
            const { updateConnectivity } = this.props;
            const setAsOnline = () => {
              updateConnectivity({ isConnected: true });
            };
            const setAsOffline = () => {
              updateConnectivity({ isConnected: false });
            };
            const addConnectionEventListeners = () => {
              window.addEventListener('offline', setAsOffline);
              window.addEventListener('online', setAsOnline);
            };
            const setCurrentConnectionStatus = () => {
              if (!navigator.onLine) {
                setAsOffline();
                return;
              }
              setAsOnline();
            };
            setCurrentConnectionStatus();
            addConnectionEventListeners();
          };
          configureConnectionStatus();
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a one-level mount-local helper that registers a window listener", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Tracker extends React.Component {
        componentDidMount() {
          function attachScrollListener() {
            window.addEventListener('scroll', this.onScroll);
          }
          attachScrollListener();
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a mount-local helper that is only stored for later, never invoked at mount", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class LazyAttach extends React.Component {
        componentDidMount() {
          const attach = () => {
            window.addEventListener('resize', this.onResize);
          };
          this.attach = attach;
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a synchronously invoked helper listening on its own local emitter", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class AddressField extends React.Component {
        componentDidMount() {
          const setupAutocomplete = () => {
            const autocomplete = places({ container: this.input });
            autocomplete.on('change', (event) => this.props.onChange(event.suggestion));
          };
          setupAutocomplete();
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a setTimeout whose instance method sets state", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         show = () => this.setState({ visible: true });
         componentDidMount() {
           setTimeout(() => this.show(), 3000);
         }
         render() {
           return null;
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setTimeout whose instance method transitively reaches setState", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         show = () => this.reveal();
         reveal = () => this.setState({ visible: true });
         componentDidMount() { setTimeout(() => this.show(), 3000); }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setTimeout bound to an instance method that sets state", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         tick() { this.setState({ visible: true }); }
         componentDidMount() { setTimeout(this.tick.bind(this), 3000); }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setTimeout callback reached through local aliases", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         tick() { this.setState({ visible: true }); }
         componentDidMount() {
           const callback = this.tick.bind(this);
           const callbackAlias = callback;
           setTimeout(callbackAlias, 3000);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mount listener registered inside a synchronous iterator callback", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Tracker extends React.Component {
         componentDidMount() {
           [window].forEach((target) => target.addEventListener("scroll", this.onScroll));
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a window listener added with no removal anywhere", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Tracker extends React.Component {
         onScroll = () => this.setState({ y: window.scrollY });
         componentDidMount() {
           window.addEventListener("scroll", this.onScroll);
         }
         render() {
           return null;
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks static computed listener and timer method names", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class ComputedInterval extends React.Component {
         componentDidMount() {
           window["setInterval"](this.tick, 1000);
         }
         render() { return null; }
       }
       class ComputedPair extends React.Component {
         componentDidMount() {
           window["addEventListener"]("resize", this.resize);
           window[\`removeEventListener\`]("resize", this.resize);
         }
         render() { return null; }
       }
       class ComputedTimeoutMutation extends React.Component {
         componentDidMount() {
           window["setTimeout"](() => this["setState"]({ ready: true }), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves stable option bindings at the registration point", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const outerOptions = { once: true };
       class CaptureMismatch extends React.Component {
         componentDidMount() {
           const captureOptions = { capture: true };
           window.addEventListener("resize", this.resize, captureOptions);
           window.removeEventListener("resize", this.resize, { capture: false });
         }
         render() { return null; }
       }
       class MutatedBeforeRegistration extends React.Component {
         componentDidMount() {
           const options = { once: true };
           options.once = false;
           window.addEventListener("load", this.load, options);
         }
         render() { return null; }
       }
       class MutatedAfterRegistration extends React.Component {
         componentDidMount() {
           const options = { once: true };
           window.addEventListener("load", this.load, options);
           options.once = false;
         }
         render() { return null; }
       }
       class ShadowedOptions extends React.Component {
         componentDidMount() {
           const outerOptions = { once: false };
           window.addEventListener("load", this.load, outerOptions);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });
});
