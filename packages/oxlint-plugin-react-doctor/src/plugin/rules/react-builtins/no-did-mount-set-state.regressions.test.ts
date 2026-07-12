import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidMountSetState } from "./no-did-mount-set-state.js";

describe("react-builtins/no-did-mount-set-state — regressions", () => {
  // setState({hasMounted: true}) is the deliberate two-pass hydration
  // pattern — the second render is the point (gatsby dev-404, victory
  // transition).
  it("stays silent on a boolean-true mount flag", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Page extends Component {
        state = { hasMounted: false };
        componentDidMount() {
          this.setState({ hasMounted: true });
        }
        render() {
          return this.state.hasMounted ? <div>full</div> : null;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // The doc exempts values that can only exist post-mount: a tooltip
  // measured from the rendered DOM (tekton FormattedDuration).
  it("stays silent when the value derives from a rendered DOM read", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class FormattedDuration extends Component {
        state = { tooltip: "" };
        componentDidMount() {
          const tooltip = this.props.intl.formatMessage(
            { id: "duration" },
            { duration: this.durationNode?.textContent },
          );
          this.setState({ tooltip });
        }
        render() {
          return <span title={this.state.tooltip} ref={(node) => (this.durationNode = node)} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // A ResizeObserver can only be constructed post-mount (suomifi Tooltip).
  it("stays silent when storing an observer constructed in componentDidMount", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Tooltip extends Component {
        state = { anchorRefObserver: undefined };
        componentDidMount() {
          const anchorRefObserver = new ResizeObserver(() => this.reposition());
          this.setState({ anchorRefObserver });
        }
        render() {
          return <div />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // zIndex computed from the rendered trigger element via a ref
  // (innovaccer PopperWrapper) — post-mount DOM measurement, two hops.
  it("stays silent when the value derives transitively from a ref.current read", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class PopperWrapper extends Component {
        state = { zIndex: undefined };
        componentDidMount() {
          const triggerElement = this.triggerRef.current;
          const zIndex = this.getZIndexForLayer(triggerElement);
          this.setState({ zIndex: zIndex === undefined ? zIndex : zIndex + 1 });
        }
        render() {
          return <div ref={this.triggerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // setState after an await in an async componentDidMount is the
  // promise-buried case the doc says must not fire in "allowed" mode
  // (dtale NetworkDisplay).
  it("stays silent on setState after an await in async componentDidMount", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class NetworkDisplay extends Component {
        state = { dtypes: [], loadingDtypes: true };
        async componentDidMount() {
          const response = await loadDtypes(this.props.dataId);
          if (response?.error) {
            this.setState({ error: response.error });
            return;
          }
          this.setState({ loadingDtypes: false, dtypes: response?.dtypes ?? [] });
        }
        render() {
          return <div />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags prop-derived setState in componentDidMount", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Hello extends Component {
        componentDidMount() {
          this.setState({ name: this.props.name.toUpperCase() });
        }
        render() {
          return <div>{this.state.name}</div>;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags setState when the `this` receiver is wrapped in `as any`", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Hello extends Component {
        componentDidMount() {
          (this as any).setState({ name: this.props.name.toUpperCase() });
        }
        render() {
          return <div>{this.state.name}</div>;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags setState before the first await in an async componentDidMount", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Loader extends Component {
        async componentDidMount() {
          this.setState({ loading: this.props.initialLoading });
          await fetchData();
        }
        render() {
          return <div />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the same mount write inside a synchronous IIFE and as a direct call", () => {
    const iifeResult = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        componentDidMount() {
          this.initializeMonthContainer = (() => {
            this.setState({ monthContainer: this.monthContainer });
          })();
        }
      }
      `,
    );
    const directResult = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
      }
      `,
    );

    expect(iifeResult.parseErrors).toEqual([]);
    expect(directResult.parseErrors).toEqual([]);
    expect(iifeResult.diagnostics).toHaveLength(1);
    expect(directResult.diagnostics).toHaveLength(1);
  });

  it("stays silent on a deferred nested mount callback", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        componentDidMount() {
          requestAnimationFrame(() => {
            this.setState({ monthContainer: this.monthContainer });
          });
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a deferred callback in an async lifecycle", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        async componentDidMount() {
          requestAnimationFrame(() => {
            this.setState({ monthContainer: this.monthContainer });
          });
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
