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

  it("does not assume separately destructured prop handlers keep the same identity", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class PixelCanvas extends React.Component {
        componentDidMount() {
          const { updateGridBoundariesThrottle } = this.props;
          window.addEventListener("resize", updateGridBoundariesThrottle);
        }
        componentWillUnmount() {
          const { updateGridBoundariesThrottle } = this.props;
          window.removeEventListener("resize", updateGridBoundariesThrottle);
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not match renamed handlers separately read from a mutable prop", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class PixelCanvas extends React.Component {
        componentDidMount() {
          const { updateGridBoundariesThrottle: mountHandler } = this.props;
          window.addEventListener("resize", mountHandler);
        }
        componentWillUnmount() {
          const { updateGridBoundariesThrottle: unmountHandler } = this.props;
          window.removeEventListener("resize", unmountHandler);
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags same-named handlers destructured from different props", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class PixelCanvas extends React.Component {
        componentDidMount() {
          const { mountHandler: handler } = this.props;
          window.addEventListener("resize", handler);
        }
        componentWillUnmount() {
          const { unmountHandler: handler } = this.props;
          window.removeEventListener("resize", handler);
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags handlers destructured from state because the value can change before unmount", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class PixelCanvas extends React.Component {
        componentDidMount() {
          const { handler } = this.state;
          window.addEventListener("resize", handler);
        }
        componentWillUnmount() {
          const { handler } = this.state;
          window.removeEventListener("resize", handler);
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts removeAllListeners for the registered emitter event", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class GistEditor extends React.Component {
        componentDidMount() {
          ipcRenderer.on("submit-gist", () => this.submit());
        }
        componentWillUnmount() {
          ipcRenderer.removeAllListeners("submit-gist");
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts removeAllListeners on a declared const emitter", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `declare const ipcRenderer: {
        on(eventName: string, listener: () => void): void;
        removeAllListeners(eventName: string): void;
      };
      class GistEditor extends React.Component {
        componentDidMount() {
          ipcRenderer.on("submit-gist", () => this.submit());
        }
        componentWillUnmount() {
          ipcRenderer.removeAllListeners("submit-gist");
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts removeAllListeners without an event for the same emitter", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class GistEditor extends React.Component {
        componentDidMount() {
          ipcRenderer.on("submit-gist", () => this.submit());
        }
        componentWillUnmount() {
          ipcRenderer.removeAllListeners();
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags removeAllListeners for another event or emitter", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class GistEditor extends React.Component {
        componentDidMount() {
          ipcRenderer.on("submit-gist", () => this.submit());
        }
        componentWillUnmount() {
          ipcRenderer.removeAllListeners("open-gist");
          otherEmitter.removeAllListeners("submit-gist");
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["on", "removeListener"],
    ["addListener", "off"],
    ["once", "removeListener"],
    ["prependListener", "off"],
    ["prependOnceListener", "removeListener"],
  ])("accepts EventEmitter %s/%s aliases", (registrationMethod, releaseMethod) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.${registrationMethod}("change", this.handleChange); }
        componentWillUnmount() { emitter.${releaseMethod}("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches stable aliases of an emitter and prototype handler", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          const mountedEmitter = sharedEmitter;
          const mountedHandler = this.handleChange;
          mountedEmitter.on("change", mountedHandler);
        }
        componentWillUnmount() {
          const cleanupEmitter = sharedEmitter;
          const cleanupHandler = this.handleChange;
          cleanupEmitter.off("change", cleanupHandler);
        }
        handleChange() {}
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches stable function declarations used as DOM handlers", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `function handleResize() {}
      class Listener extends React.Component {
        componentDidMount() { window.addEventListener("resize", handleResize); }
        componentWillUnmount() { window.removeEventListener("resize", handleResize); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches MediaQueryList listener cleanup and stable nested global receivers", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          mediaQuery.addListener(this.handleChange);
          window.visualViewport.addEventListener("resize", this.handleResize);
          document.body.addEventListener("click", this.handleClick);
        }
        componentWillUnmount() {
          mediaQuery.removeListener(this.handleChange);
          window.visualViewport.removeEventListener("resize", this.handleResize);
          document.body.removeEventListener("click", this.handleClick);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["handler", `this.handler = this.nextHandler;`],
    ["receiver", `this.bus = otherBus;`],
    ["event", `this.state.event = "other";`],
  ])("does not trust mutable instance %s identity", (_identity, mutation) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          this.bus.on(this.state.event, this.handler);
          ${mutation}
        }
        componentWillUnmount() { this.bus.off(this.state.event, this.handler); }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts identity mutation after the matching unmount cleanup", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { this.bus.on("change", this.handleChange); }
        componentWillUnmount() {
          this.bus.off("change", this.handleChange);
          this.bus = otherBus;
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust getter-backed listener identities", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class GetterHandler extends React.Component {
        get handler() { return this.props.handler; }
        componentDidMount() { emitter.on("change", this.handler); }
        componentWillUnmount() { emitter.off("change", this.handler); }
        render() { return null; }
      }
      class GetterBus extends React.Component {
        get bus() { return this.props.bus; }
        componentDidMount() { this.bus.on("change", this.handleChange); }
        componentWillUnmount() { this.bus.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not match identities through mutable object properties", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { registry.bus.on("change", registry.handler); }
        componentWillUnmount() { registry.bus.off("change", registry.handler); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts stored subscription teardown APIs", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          this.storeSubscription = store.subscribe(this.handleChange);
          this.keyboardSubscription = Keyboard.addListener("show", this.handleShow);
          this.dimensionSubscription = Dimensions.addEventListener("change", this.handleResize);
        }
        componentWillUnmount() {
          this.storeSubscription.unsubscribe();
          this.keyboardSubscription.remove();
          this.dimensionSubscription.remove();
        }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a stored callable unsubscribe", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { this.unsubscribe = store.subscribe(this.handleChange); }
        componentWillUnmount() { this.unsubscribe(); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a mount-local emitter quiet through a const alias", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          const emitter = new EventTarget();
          const alias = emitter;
          alias.addEventListener("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts listener cleanup delegated to an instance method", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { this.attach(); }
        attach() { emitter.on("change", this.handleChange); }
        componentWillUnmount() { this.detach(); }
        detach() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts listener cleanup delegated to a stable local helper", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() {
          const cleanup = () => emitter.off("change", this.handleChange);
          cleanup();
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("counts repeated delegated cleanup invocations", () => {
    const classHelper = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() { this.detach(); this.detach(); }
        detach() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const localHelper = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() {
          const detach = () => emitter.off("change", this.handleChange);
          detach();
          detach();
        }
        render() { return null; }
      }`,
    );
    expect(classHelper.diagnostics).toHaveLength(0);
    expect(localHelper.diagnostics).toHaveLength(0);
  });

  it("counts duplicate cleanup calls on every branch", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() {
          if (enabled) {
            emitter.off("change", this.handleChange);
            emitter.off("change", this.handleChange);
          } else {
            emitter.off("change", this.handleChange);
            emitter.off("change", this.handleChange);
          }
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust reassigned or duplicate cleanup methods", () => {
    const reassigned = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() {
          this.detach = () => {};
          this.detach();
        }
        detach() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const duplicate = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() { this.detach(); }
        detach() { emitter.off("change", this.handleChange); }
        detach() {}
        render() { return null; }
      }`,
    );
    expect(reassigned.diagnostics).toHaveLength(1);
    expect(duplicate.diagnostics).toHaveLength(1);
  });

  it("accepts AbortController signal cleanup", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        controller = new AbortController();
        componentDidMount() {
          window.addEventListener("resize", this.handleResize, {
            signal: this.controller.signal,
          });
        }
        componentWillUnmount() { this.controller.abort(); }
        render() { return null; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags conditional same-mount removal and duplicate registrations", () => {
    const conditionalRemoval = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          if (enabled) emitter.off("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    const duplicateRegistration = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
          emitter.off("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    expect(conditionalRemoval.diagnostics).toHaveLength(1);
    expect(duplicateRegistration.diagnostics).toHaveLength(1);
  });

  it("accepts unconditional same-mount EventEmitter cleanup", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.off("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("deduplicates identical DOM registrations but counts EventEmitter registrations", () => {
    const domResult = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          window.addEventListener("resize", this.handleResize);
          window.addEventListener("resize", this.handleResize);
          window.removeEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }`,
    );
    const oneEmitterCleanup = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const twoEmitterCleanups = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() {
          emitter.off("change", this.handleChange);
          emitter.removeListener("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    const sameMountRemoveAll = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.removeAllListeners("change");
        }
        render() { return null; }
      }`,
    );
    const sameMountTwoCleanups = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() {
          emitter.on("change", this.handleChange);
          emitter.on("change", this.handleChange);
          emitter.off("change", this.handleChange);
          emitter.off("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    expect(domResult.diagnostics).toHaveLength(0);
    expect(oneEmitterCleanup.diagnostics).toHaveLength(1);
    expect(twoEmitterCleanups.diagnostics).toHaveLength(0);
    expect(sameMountRemoveAll.diagnostics).toHaveLength(0);
    expect(sameMountTwoCleanups.diagnostics).toHaveLength(0);
  });

  it("does not accept returned remove cleanup from a shadowed React Native receiver", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const Keyboard = {
        addEventListener() { return { remove() {} }; },
      };
      class Listener extends React.Component {
        componentDidMount() {
          this.subscription = Keyboard.addEventListener("show", this.handleShow);
        }
        componentWillUnmount() { this.subscription.remove(); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts aliased React Native subscriptions but rejects wrong-module receivers", () => {
    const aliased = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { Dimensions as RNDimensions } from "react-native";
      class Listener extends React.Component {
        componentDidMount() {
          this.subscription = RNDimensions.addEventListener("change", this.handleChange);
        }
        componentWillUnmount() { this.subscription.remove(); }
        render() { return null; }
      }`,
    );
    const wrongModule = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { Keyboard } from "keyboard-kit";
      class Listener extends React.Component {
        componentDidMount() {
          this.subscription = Keyboard.addListener("show", this.handleShow);
        }
        componentWillUnmount() { this.subscription.remove(); }
        render() { return null; }
      }`,
    );
    expect(aliased.diagnostics).toHaveLength(0);
    expect(wrongModule.diagnostics).toHaveLength(1);
  });

  it("requires cleanup before any potentially throwing unmount call", () => {
    const beforeCleanup = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const fail = () => { throw new Error("failed"); };
      class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() { fail(); emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const opaqueBeforeCleanup = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() { mayThrow(); emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const afterCleanup = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        componentWillUnmount() { emitter.off("change", this.handleChange); mayThrow(); }
        render() { return null; }
      }`,
    );
    expect(beforeCleanup.diagnostics).toHaveLength(1);
    expect(opaqueBeforeCleanup.diagnostics).toHaveLength(1);
    expect(afterCleanup.diagnostics).toHaveLength(0);
  });

  it("flags cleanup that happens only after an await", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        componentDidMount() { emitter.on("change", this.handleChange); }
        async componentWillUnmount() {
          await flush();
          emitter.off("change", this.handleChange);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags acquisition after mount suspension but accepts acquisition before it", () => {
    const afterAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        async componentDidMount() {
          await prepare();
          emitter.on("change", this.handleChange);
        }
        componentWillUnmount() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    const beforeAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
        async componentDidMount() {
          emitter.on("change", this.handleChange);
          await prepare();
        }
        componentWillUnmount() { emitter.off("change", this.handleChange); }
        render() { return null; }
      }`,
    );
    expect(afterAwait.diagnostics).toHaveLength(1);
    expect(beforeAwait.diagnostics).toHaveLength(0);
  });

  it.each([
    ["bare", `const schedule = setInterval;`],
    ["member", `const schedule = window.setInterval;`],
    ["destructured", `const { setInterval: schedule } = window;`],
  ])("recognizes readonly %s aliases of global timers", (_shape, declaration) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `${declaration}
      class Clock extends React.Component {
        componentDidMount() { schedule(() => this.setState({ tick: true }), 1000); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when componentWillUnmount does not release the mounted resource", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component {
        componentDidMount() { window.addEventListener("resize", this.handleResize); }
        componentWillUnmount() { console.log("bye"); }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("without a matching teardown");
    expect(result.diagnostics[0]?.message).not.toContain("declares no `componentWillUnmount`");
  });

  it("flags when componentWillUnmount releases the resource only conditionally", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component {
        componentDidMount() { window.addEventListener("resize", this.handleResize); }
        componentWillUnmount() {
          if (this.enabled) window.removeEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("still flags unrelated listeners when the class uses disposeOnUnmount", () => {
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
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts proven disposeOnUnmount cleanup for the acquired resource", () => {
    const aliasedImportListener = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount as dispose } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           dispose(this, () => window.removeEventListener("resize", this.handleResize));
         }
         render() { return null; }
       }`,
    );
    const namespaceTimer = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import * as MobxReact from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.timer = setInterval(() => this.tick(), 1000);
           MobxReact.disposeOnUnmount(this, () => clearInterval(this.timer));
         }
         render() { return null; }
       }`,
    );
    const handlerOnlySubscription = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.store.subscribe(this.handleChange);
           disposeOnUnmount(this, () => this.store.unsubscribe(this.handleChange));
         }
         render() { return null; }
       }`,
    );
    const onceSubscription = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.bus.once("data", this.handleData);
           disposeOnUnmount(this, () => this.bus.off("data", this.handleData));
         }
         render() { return null; }
       }`,
    );
    expect(aliasedImportListener.diagnostics).toHaveLength(0);
    expect(namespaceTimer.diagnostics).toHaveLength(0);
    expect(handlerOnlySubscription.diagnostics).toHaveLength(0);
    expect(onceSubscription.diagnostics).toHaveLength(0);
  });

  it("requires disposeOnUnmount registration and release on every path after acquisition", () => {
    const conditionalRegistration = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           if (this.enabled) {
             disposeOnUnmount(this, () =>
               window.removeEventListener("resize", this.handleResize),
             );
           }
         }
         render() { return null; }
       }`,
    );
    const conditionalRelease = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           disposeOnUnmount(this, () => {
             if (this.enabled) {
               window.removeEventListener("resize", this.handleResize);
             }
           });
         }
         render() { return null; }
       }`,
    );
    expect(conditionalRegistration.diagnostics).toHaveLength(1);
    expect(conditionalRelease.diagnostics).toHaveLength(1);
  });

  it("requires proven disposeOnUnmount provenance, owner, and matching cleanup", () => {
    const localHomonym = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const disposeOnUnmount = (owner, cleanup) => cleanup;
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           disposeOnUnmount(this, () => window.removeEventListener("resize", this.handleResize));
         }
         render() { return null; }
       }`,
    );
    const wrongOwner = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           disposeOnUnmount(other, () => window.removeEventListener("resize", this.handleResize));
         }
         render() { return null; }
       }`,
    );
    const wrongListener = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           window.addEventListener("resize", this.handleResize);
           disposeOnUnmount(this, () => window.removeEventListener("scroll", this.handleResize));
         }
         render() { return null; }
       }`,
    );
    const shadowedNamespace = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import * as MobxReact from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           const MobxReact = fakeMobxReact;
           window.addEventListener("resize", this.handleResize);
           MobxReact.disposeOnUnmount(this, () => window.removeEventListener("resize", this.handleResize));
         }
         render() { return null; }
       }`,
    );
    const wrongSubscribeArity = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.store.subscribe(this.handleChange);
           disposeOnUnmount(this, () => this.store.unsubscribe("data", this.handleChange));
         }
         render() { return null; }
       }`,
    );
    const wrongEvent = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.bus.on("data", this.handleData);
           disposeOnUnmount(this, () => this.bus.off("other", this.handleData));
         }
         render() { return null; }
       }`,
    );
    const wrongHandler = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.bus.once("data", this.handleData);
           disposeOnUnmount(this, () => this.bus.off("data", this.handleOther));
         }
         render() { return null; }
       }`,
    );
    const missingHandler = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react";
       class C extends React.Component {
         componentDidMount() {
           this.bus.on("data");
           disposeOnUnmount(this, () => this.bus.off("data"));
         }
         render() { return null; }
       }`,
    );
    expect(localHomonym.diagnostics).toHaveLength(1);
    expect(wrongOwner.diagnostics).toHaveLength(1);
    expect(wrongListener.diagnostics).toHaveLength(1);
    expect(shadowedNamespace.diagnostics).toHaveLength(1);
    expect(wrongSubscribeArity.diagnostics).toHaveLength(1);
    expect(wrongEvent.diagnostics).toHaveLength(1);
    expect(wrongHandler.diagnostics).toHaveLength(1);
    expect(missingHandler.diagnostics).toHaveLength(1);
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

  it("tracks transparent wrappers around global timer receivers", () => {
    const castGlobalReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Clock extends React.Component {
        componentDidMount() {
          (window as any).setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    const assertedGlobalReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Clock extends React.Component {
        componentDidMount() {
          window!.setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    const shadowedGlobalReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const window = scheduler;
      class Clock extends React.Component {
        componentDidMount() {
          (window as any).setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    const unrelatedReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Clock extends React.Component {
        componentDidMount() {
          (scheduler as any).setInterval(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    expect(castGlobalReceiver.diagnostics).toHaveLength(1);
    expect(assertedGlobalReceiver.diagnostics).toHaveLength(1);
    expect(shadowedGlobalReceiver.diagnostics).toHaveLength(0);
    expect(unrelatedReceiver.diagnostics).toHaveLength(0);
  });

  it("tracks transparent wrappers around timer callees", () => {
    const wrappedBareTimer = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Clock extends React.Component {
        componentDidMount() {
          (setInterval as typeof setInterval)(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    const wrappedGlobalTimer = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Clock extends React.Component {
        componentDidMount() {
          (window.setInterval as typeof window.setInterval)(() => this.tick(), 1000);
        }
        render() { return null; }
      }`,
    );
    expect(wrappedBareTimer.diagnostics).toHaveLength(1);
    expect(wrappedGlobalTimer.diagnostics).toHaveLength(1);
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

  it("tracks transparent wrappers when a mount-local emitter escapes", () => {
    const castEscape = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Legend extends React.Component {
        componentDidMount() {
          const network = new Network();
          network.on("draw", this.draw);
          this.network = network as Network;
        }
        render() { return null; }
      }`,
    );
    const assertedEscape = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Legend extends React.Component {
        componentDidMount() {
          const network = new Network();
          network.on("draw", this.draw);
          this.network = network!;
        }
        render() { return null; }
      }`,
    );
    const unrelatedAssignment = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Legend extends React.Component {
        componentDidMount() {
          const network = new Network();
          network.on("draw", this.draw);
          this.network = externalNetwork as Network;
        }
        render() { return null; }
      }`,
    );
    expect(castEscape.diagnostics).toHaveLength(1);
    expect(assertedEscape.diagnostics).toHaveLength(1);
    expect(unrelatedAssignment.diagnostics).toHaveLength(0);
  });

  it("tracks mount-local receivers and escapes by binding identity", () => {
    const shadowedLocalReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Legend extends React.Component {
         componentDidMount() {
           const network = externalNetwork;
           { const network = new Network(); void network; }
           network.on("draw", this.draw);
         }
         render() { return null; }
       }`,
    );
    const shadowedEscape = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Legend extends React.Component {
         componentDidMount() {
           const network = new Network();
           { const network = externalNetwork; this.network = network; }
           network.on("draw", this.draw);
         }
         render() { return null; }
       }`,
    );
    expect(shadowedLocalReceiver.diagnostics).toHaveLength(1);
    expect(shadowedEscape.diagnostics).toHaveLength(0);
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

  it("tracks transparent wrappers around mount-local factory callees", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Search extends React.Component {
         componentDidMount() {
           const autocomplete = (places as typeof places)({ container: this.input });
           autocomplete.on("change", this.onChange);
         }
         render() { return null; }
       }`,
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

  it("flags an addEventListener with { once: true } because it can outlive an unmount", () => {
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
    expect(result.diagnostics).toHaveLength(1);
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
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag a listener on a non-null asserted ref-owned DOM node", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          this.containerRef.current!.addEventListener("wheel", this.handleWheel);
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

  it("tracks stable aliases of ref-owned DOM receivers", () => {
    const refAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          const container = (this.containerRef.current as HTMLElement)!;
          const localContainer = container;
          localContainer.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return <div ref={this.containerRef} />; }
      }`,
    );
    const documentAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        componentDidMount() {
          const target = document.body;
          target.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    const windowAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        componentDidMount() {
          const target = window;
          target.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    const reassignedRefAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          let target = this.containerRef.current;
          target = document.body;
          target.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return <div ref={this.containerRef} />; }
      }`,
    );
    expect(refAlias.diagnostics).toHaveLength(0);
    expect(documentAlias.diagnostics).toHaveLength(1);
    expect(windowAlias.diagnostics).toHaveLength(1);
    expect(reassignedRefAlias.diagnostics).toHaveLength(1);
  });

  it("requires ref-owned listener receivers to originate from a stable class createRef field", () => {
    const importedCreateRef = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { createRef as makeRef } from "react";
      class Chart extends React.Component {
        containerRef = makeRef();
        componentDidMount() {
          const container = this.containerRef.current;
          container.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return <div ref={this.containerRef} />; }
      }`,
    );
    const propRef = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        componentDidMount() {
          this.props.containerRef.current.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    const externalRef = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `const externalRef = { current: window };
      class Chart extends React.Component {
        componentDidMount() {
          externalRef.current.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    const arbitraryCurrentField = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        containerRef = { current: window };
        componentDidMount() {
          this.containerRef.current.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    const callDerivedReceiver = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          wrap(this.containerRef.current).on("change", this.handleChange);
        }
        handleChange = () => {};
        render() { return <div ref={this.containerRef} />; }
      }`,
    );
    const reassignedClassRef = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Chart extends React.Component {
        containerRef = React.createRef();
        componentDidMount() {
          this.containerRef = this.props.containerRef;
          this.containerRef.current.addEventListener("wheel", this.handleWheel);
        }
        handleWheel = () => {};
        render() { return null; }
      }`,
    );
    expect(importedCreateRef.diagnostics).toHaveLength(0);
    expect(propRef.diagnostics).toHaveLength(1);
    expect(externalRef.diagnostics).toHaveLength(1);
    expect(arbitraryCurrentField.diagnostics).toHaveLength(1);
    expect(callDerivedReceiver.diagnostics).toHaveLength(1);
    expect(reassignedClassRef.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-null asserted mount-local listener receiver", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Chart extends React.Component {
        componentDidMount() {
          const emitter = new Emitter();
          emitter!.on("change", this.handleChange);
        }
        handleChange = () => {};
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a non-null asserted external listener receiver", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class Chart extends React.Component {
        componentDidMount() {
          external!.addEventListener("change", this.handleChange);
        }
        handleChange = () => {};
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag call-derived d3 selections rooted in a class-owned ref", () => {
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

  it("does not flag call-derived d3 selections rooted at a non-null asserted ref", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class BarChart extends React.Component {
  svgRef = React.createRef();
  componentDidMount() {
    d3.select(this.svgRef.current!)
      .selectAll("rect")
      .on("mouseover", this.props.onBarHover);
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

  it.each(["undefined", "null", "0", "{ capture: undefined }"])(
    "normalizes a statically false capture option %s",
    (captureOption) => {
      const result = runRule(
        classComponentMissingComponentWillUnmountTeardown,
        `class Listener extends React.Component {
          componentDidMount() {
            window.addEventListener("resize", this.handleResize, ${captureOption});
          }
          componentWillUnmount() {
            window.removeEventListener("resize", this.handleResize);
          }
          render() { return null; }
        }`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

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

  it("flags a { once: true } listener whose options object lives in a variable", () => {
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
    expect(result.diagnostics).toHaveLength(1);
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

  it("follows wrapped mount helpers, aliases, and iterator callees", () => {
    const wrappedHelper = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component {
         componentDidMount() {
           const attach = () => window.addEventListener("resize", this.onResize);
           (attach as typeof attach)();
         }
         render() { return null; }
       }`,
    );
    const wrappedAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component {
         componentDidMount() {
           const attach = () => window.addEventListener("resize", this.onResize);
           const alias = attach as typeof attach;
           alias();
         }
         render() { return null; }
       }`,
    );
    const wrappedIterator = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component {
         componentDidMount() {
           ([window].forEach as typeof Array.prototype.forEach)(
             (target) => target.addEventListener("resize", this.onResize),
           );
         }
         render() { return null; }
       }`,
    );
    expect(wrappedHelper.diagnostics).toHaveLength(1);
    expect(wrappedAlias.diagnostics).toHaveLength(1);
    expect(wrappedIterator.diagnostics).toHaveLength(1);
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

  it("flags wrapped bind callees for instance methods that set state", () => {
    const castBind = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         tick() { this.setState({ visible: true }); }
         componentDidMount() {
           setTimeout((this.tick.bind as typeof this.tick.bind)(this), 3000);
         }
         render() { return null; }
       }`,
    );
    const assertedBind = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         tick() { this.setState({ visible: true }); }
         componentDidMount() {
           setTimeout(this.tick.bind!(this), 3000);
         }
         render() { return null; }
       }`,
    );
    expect(castBind.diagnostics).toHaveLength(1);
    expect(assertedBind.diagnostics).toHaveLength(1);
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
       }
       class ComputedWrongRemoval extends React.Component {
         componentDidMount() {
           window["addEventListener"]("resize", this.resize);
           window[\`removeEventListener\`]("scroll", this.resize);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(3);
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
    expect(result.diagnostics).toHaveLength(4);
  });

  it("tracks state mutation through transparent this wrappers", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class AssertedThis extends React.Component {
         componentDidMount() {
           setTimeout(() => {
             const update = () => (this as any).setState({ ready: true });
             update();
           }, 100);
         }
         render() { return null; }
       }
       class NonNullThis extends React.Component {
         componentDidMount() {
           setTimeout(() => {
             const update = () => this!.setState({ ready: true });
             update();
           }, 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("tracks state mutation through transparent callee wrappers", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class DirectMutation extends React.Component {
         componentDidMount() {
           setTimeout(() => {
             (this.setState as typeof this.setState)({ ready: true });
           }, 100);
         }
         render() { return null; }
       }
       class HelperMutation extends React.Component {
         refresh = () => (this.setState as typeof this.setState)({ ready: true });
         componentDidMount() {
           setTimeout(() => (this.refresh as typeof this.refresh)(), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("treats owned setState wrappers as component mutations", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Banner extends React.Component {
         setState(nextState) {
           super.setState(nextState);
         }
         componentDidMount() {
           setTimeout(() => this.setState({ ready: true }), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks forceUpdate helpers and transparent bound this arguments", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class ForceUpdater extends React.Component {
         refresh = () => this.forceUpdate();
         componentDidMount() {
           setTimeout(() => this.refresh(), 100);
         }
         render() { return null; }
       }
       class NonNullBoundThis extends React.Component {
         refresh = () => this.setState({ ready: true });
         componentDidMount() {
           setTimeout(this.refresh.bind(this!), 100);
         }
         render() { return null; }
       }
       class AssertedBoundThis extends React.Component {
         refresh = () => this.setState({ ready: true });
         componentDidMount() {
           setTimeout(this.refresh.bind(this as any), 100);
         }
         render() { return null; }
       }
       class WrongBoundReceiver extends React.Component {
         refresh = () => this.setState({ ready: true });
         componentDidMount() {
           setTimeout(this.refresh.bind(other), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags a mount-local emitter that escapes through an unknown call", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import React from "react";
       class Panel extends React.Component {
         componentDidMount() {
           const emitter = new EventTarget();
           registry.add(emitter);
           emitter.addEventListener("change", () => this.setState({ ready: true }));
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a shadowed runInAction that does not mutate the component", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import React from "react";
       const runInAction = (callback) => callback();
       class Panel extends React.Component {
         componentDidMount() {
           setTimeout(() => runInAction(() => console.log("done")), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a local runInAction shadowing the MobX import", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import React from "react";
       import { runInAction } from "mobx";
       class Panel extends React.Component {
         componentDidMount() {
           const runInAction = (callback) => callback();
           setTimeout(() => runInAction(() => console.log("done")), 100);
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores component mutations inside an uninvoked nested class helper", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import React from "react";
       class Panel extends React.Component {
         componentDidMount() {
           setTimeout(() => this.logReady(), 100);
         }
         logReady() {
           const unused = () => this.setState({ ready: true });
           console.log("ready");
         }
         render() { return null; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an earlier await whose branch exits before acquisition", () => {
    const exclusiveAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           if (this.skip) {
             await prepare();
             return;
           }
           emitter.on("change", this.handleChange);
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const flowingAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           if (this.prepare) await prepare();
           emitter.on("change", this.handleChange);
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    expect(exclusiveAwait.diagnostics).toHaveLength(0);
    expect(flowingAwait.diagnostics).toHaveLength(1);
  });

  it("propagates suspension state through invoked class helpers", () => {
    const afterAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           await prepare();
           this.attach();
         }
         attach() { emitter.on("change", this.handleChange); }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const beforeAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           this.attach();
           await prepare();
         }
         attach() { emitter.on("change", this.handleChange); }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    expect(afterAwait.diagnostics).toHaveLength(1);
    expect(beforeAwait.diagnostics).toHaveLength(0);
  });

  it("propagates suspension state through invoked local helpers", () => {
    const afterAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           const attach = () => emitter.on("change", this.handleChange);
           await prepare();
           attach();
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const beforeAwait = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         async componentDidMount() {
           const attach = () => emitter.on("change", this.handleChange);
           attach();
           await prepare();
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    expect(afterAwait.diagnostics).toHaveLength(1);
    expect(beforeAwait.diagnostics).toHaveLength(0);
  });

  it("tracks exact local resources stored on the component instance", () => {
    const subscription = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { Keyboard } from "react-native";
       class Listener extends React.Component {
         componentDidMount() {
           const subscription = Keyboard.addListener("show", this.handleShow);
           this.subscription = subscription;
         }
         componentWillUnmount() { this.subscription.remove(); }
         render() { return null; }
       }`,
    );
    const controller = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           const controller = new AbortController();
           this.controller = controller;
           window.addEventListener("resize", this.handleResize, { signal: controller.signal });
         }
         componentWillUnmount() { this.controller.abort(); }
         render() { return null; }
       }`,
    );
    const conditionalAlias = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `import { Keyboard } from "react-native";
       class Listener extends React.Component {
         componentDidMount() {
           const subscription = Keyboard.addListener("show", this.handleShow);
           if (this.keepSubscription) this.subscription = subscription;
         }
         componentWillUnmount() { this.subscription.remove(); }
         render() { return null; }
       }`,
    );
    expect(subscription.diagnostics).toHaveLength(0);
    expect(controller.diagnostics).toHaveLength(0);
    expect(conditionalAlias.diagnostics).toHaveLength(1);
  });

  it("counts registrations by executable path and repeating loops", () => {
    const exclusiveBranches = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           if (this.primary) emitter.on("change", this.handleChange);
           else emitter.on("change", this.handleChange);
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const sequential = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           emitter.on("change", this.handleChange);
           emitter.on("change", this.handleChange);
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const repeatingLoop = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           for (let index = 0; index < 3; index += 1) {
             emitter.on("change", this.handleChange);
           }
         }
         componentWillUnmount() { emitter.off("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const repeatingLoopRemoveAll = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           for (let index = 0; index < 3; index += 1) {
             emitter.on("change", this.handleChange);
           }
         }
         componentWillUnmount() { emitter.removeAllListeners("change"); }
         render() { return null; }
       }`,
    );
    const unreachableLoop = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           for (; false; ) emitter.on("change", this.handleChange);
         }
         render() { return null; }
       }`,
    );
    const unreachableHelper = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           if (false) this.attach();
         }
         attach() { emitter.on("change", this.handleChange); }
         render() { return null; }
       }`,
    );
    const perIterationRemoval = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `class Listener extends React.Component {
         componentDidMount() {
           for (const item of this.items) {
             emitter.on("change", this.handleChange);
             emitter.off("change", this.handleChange);
           }
         }
         render() { return null; }
       }`,
    );
    expect(exclusiveBranches.diagnostics).toHaveLength(0);
    expect(sequential.diagnostics).toHaveLength(1);
    expect(repeatingLoop.diagnostics).toHaveLength(1);
    expect(repeatingLoopRemoveAll.diagnostics).toHaveLength(0);
    expect(unreachableLoop.diagnostics).toHaveLength(0);
    expect(unreachableHelper.diagnostics).toHaveLength(0);
    expect(perIterationRemoval.diagnostics).toHaveLength(0);
  });
});
