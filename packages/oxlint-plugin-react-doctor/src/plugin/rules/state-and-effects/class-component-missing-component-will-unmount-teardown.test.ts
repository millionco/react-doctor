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
      `
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
      `
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
      `
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
      `
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
      `
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
      `
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
      `
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
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the class uses disposeOnUnmount", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
      class C extends React.Component {
        componentDidMount() {
          disposeOnUnmount(this, reaction(() => this.value, () => {}));
          window.addEventListener("resize", this.handleResize);
        }
        render() { return null; }
      }
      `
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
      `
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
      `
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
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
