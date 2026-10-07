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

  it("stays silent when storing a DOM node supplied by a named callback ref", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        state = { monthContainer: undefined };
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          if (this.props.showTimeSelect) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when storing a DOM node supplied by an inline callback ref", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        state = { monthContainer: undefined };
        monthContainer = undefined;
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={(element) => (this.monthContainer = element ?? undefined)} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when callback-ref fields reach state through lifecycle locals", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const monthContainer = this.monthContainer;
          const layout = { monthContainer };
          this.setState({ monthContainer: layout.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when an exclusively callback-ref-owned field starts as void zero", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = void 0;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a class field written by a callback that is not used as a ref", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainer = (value) => {
          this.monthContainer = value ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <button onClick={this.setMonthContainer}>Set</button>;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a different class field when the component owns a callback ref", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        selection = undefined;
        setSelectionRef = (element) => {
          this.selection = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setSelectionRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref field that has another writer", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        overrideMonthContainer = (value) => {
          this.monthContainer = value;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return (
            <>
              <div ref={this.setMonthContainerRef} />
              <button onClick={() => this.overrideMonthContainer(this.props.value)}>Set</button>
            </>
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `this["monthContainer"] = value;`,
    `this[this.props.fieldName] = value;`,
    `Object.assign(this, { monthContainer: value });`,
    `const MutationObject = Object; MutationObject.assign(this, { monthContainer: value });`,
    `Object.defineProperty(this, "monthContainer", { value });`,
    `Object.defineProperties(this, { monthContainer: { value } });`,
    `Reflect.set(this, "monthContainer", value);`,
    `Reflect.defineProperty(this, "monthContainer", { value });`,
    `Reflect.deleteProperty(this, "monthContainer");`,
  ])("still flags a callback-ref field with the competing writer %s", (competingWrite) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        overrideMonthContainer = (value) => {
          ${competingWrite}
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return (
            <>
              <div ref={this.setMonthContainerRef} />
              <button onClick={() => this.overrideMonthContainer(this.props.value)}>Set</button>
            </>
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref field initialized from props", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = this.props.initialContainer;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when only the setState completion callback reads the ref field", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ selectedDate: this.props.selectedDate }, () => {
            positionTimeList(this.monthContainer);
          });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when a nested payload callback reads the ref field", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({
            selectedDate: this.props.selectedDate,
            getContainer: () => this.monthContainer,
          });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when a nested function shadows the lifecycle local", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const container = this.props.initialContainer;
          const readLater = () => {
            const container = this.monthContainer;
            return container;
          };
          this.setState({ container, readLater });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when one callback ref assigns its field in separate branches", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          if (element) {
            this.monthContainer = element;
          } else {
            this.monthContainer = element;
          }
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an invoked lifecycle helper reads the callback-ref field", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const readMonthContainer = () => this.monthContainer;
          const monthContainer = readMonthContainer();
          this.setState({ monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the sole callback ref also writes through Object.assign", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
          Object.assign(this, { monthContainer: element });
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a nested competing writer inside a callback-ref mutation call", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          Object.assign(this, {
            monthContainer: element,
            overwriteLater: () => {
              this.monthContainer = this.props.fallbackContainer;
            },
          });
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `this["monthContainer"] = element ?? undefined;`,
    `Object.assign(this, { monthContainer: element });`,
    `Reflect.set(this, "monthContainer", element);`,
    `const MutationObject = Object; MutationObject.assign(this, { monthContainer: element });`,
    `const MutationReflect = Reflect; MutationReflect.set(this, "monthContainer", element);`,
  ])("stays silent when the callback ref writes its field through %s", (refWrite) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          ${refWrite}
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `instance.monthContainer = element ?? undefined;`,
    `Object.assign(instance, { monthContainer: element });`,
    `Reflect.set(instance, "monthContainer", element);`,
  ])("stays silent when a callback ref writes through a this alias: %s", (refWrite) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          const instance = this;
          ${refWrite}
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the payload reads a static bracket callback-ref field", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this["monthContainer"] });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mixed payload with callback-ref and pre-mount values", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({
            monthContainer: this.monthContainer,
            selected: this.props.selected,
          });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `this.monthContainer || this.props.fallbackContainer`,
    `this.props.useMountedContainer ? this.monthContainer : this.props.fallbackContainer`,
  ])("still flags a callback-ref value mixed with pre-mount input: %s", (value) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: ${value} });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a lifecycle local mixing callback-ref and pre-mount values", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const monthContainer = this.monthContainer ?? this.props.fallbackContainer;
          this.setState({ monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a local helper mixing callback-ref and pre-mount values", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const readMonthContainer = () =>
            this.monthContainer ?? this.props.fallbackContainer;
          this.setState({ monthContainer: readMonthContainer() });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a callback-ref value has only a literal fallback", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer ?? null });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on rendered span heights mapped from Object.keys", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import React, { Component } from "react";
      class TextBox extends Component {
        componentDidMount() {
          const heights = Object.keys(this.spanHeights)
            .map((key) => this.spanHeights[key].clientHeight);
          const firstH = heights[0];
          const lastH = heights[heights.length - 1];
          const totH = heights.reduce(
            (accumulator, currentValue) => accumulator + currentValue,
            0,
          );
          this.setState({ totH, firstH, lastH });
        }
        render() {
          this.spanHeights = {};
          return React.Children.map(this.props.children, (child, index) =>
            React.cloneElement(child, {
              ref: (span) => (this.spanHeights[\`span\${index + 1}\`] = span),
            }),
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a mounted flag paired with a rendered DOM width", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      import { findDOMNode } from "react-dom";
      class Image extends Component {
        componentDidMount() {
          const dom = findDOMNode(this);
          const rect = dom.getBoundingClientRect();
          const width = Math.round(rect.right - rect.left);
          this.setState({
            mounted: true,
            width,
          });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an overflow flag paired with a createRef height", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import React from "react";
      class ToggleMore extends React.PureComponent {
        overflow = React.createRef();
        componentDidMount() {
          if (this.overflow.current) {
            const height = this.overflow.current.clientHeight;
            if (height > this.state.checkHeight && !this.state.overflow) {
              this.setState({
                overflow: true,
                max: height,
              });
            }
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `this.props.elements.map((element) => element.clientHeight)`,
    `this.props.deferredMap((element) => element.clientHeight)`,
  ])("still flags post-mount-looking reads inside an unproven callback host: %s", (value) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Gallery extends Component {
        componentDidMount() {
          const heights = ${value};
          this.setState({ heights });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mount flag paired with a prop-derived value", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Image extends Component {
        componentDidMount() {
          this.setState({
            mounted: true,
            width: this.props.width,
          });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores nested class aliases and callback-ref handler reads", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          class NestedCalendar {
            readHandler() {
              const instance = this;
              return instance.setMonthContainerRef;
            }
          }
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a callback-ref field written through a captured alias in a nested class", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        render() {
          const calendar = this;
          class NestedCalendar {
            overwriteMonthContainer(value) {
              calendar.monthContainer = value;
            }
          }
          return <div ref={this.setMonthContainerRef} />;
        }
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a same-named field written through a nested class instance", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        render() {
          class NestedCalendar {
            overwriteMonthContainer(value) {
              this.monthContainer = value;
            }
          }
          return <div ref={this.setMonthContainerRef} />;
        }
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a synchronous map returns callback-ref measurements", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Gallery extends Component {
        measuredElement = undefined;
        setMeasuredElementRef = (element) => {
          this.measuredElement = element ?? undefined;
        };
        componentDidMount() {
          const elements = [0].map(() => this.measuredElement);
          this.setState({ elements });
        }
        render() {
          return <div ref={this.setMeasuredElementRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags callback-ref reads inside an unproven map callback", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Gallery extends Component {
        measuredElement = undefined;
        setMeasuredElementRef = (element) => {
          this.measuredElement = element ?? undefined;
        };
        componentDidMount() {
          const heights = this.props.collection.map(
            () => this.measuredElement.clientHeight,
          );
          this.setState({ heights });
        }
        render() {
          return <div ref={this.setMeasuredElementRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref handler invoked with a prop value", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setMonthContainerRef(this.props.monthContainer);
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on callback-ref measurements captured inside a synchronous IIFE", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          (() => {
            const height = this.monthContainer.clientHeight;
            this.setState({ height });
          })();
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags prop-derived locals captured inside a synchronous IIFE", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        componentDidMount() {
          (() => {
            const height = this.props.height;
            this.setState({ height });
          })();
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

  it("still flags a callback-ref handler invoked through a this alias", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const instance = this;
          instance.setMonthContainerRef(this.props.monthContainer);
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a callback-ref handler is referenced through a this alias", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          const instance = this;
          return (
            <>
              <div ref={this.setMonthContainerRef} />
              <div ref={instance.setMonthContainerRef} />
            </>
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a JSX ref wrapper forwards its element to a callback-ref handler", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={(element) => this.setMonthContainerRef(element)} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a JSX ref wrapper that does not forward the callback element", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return (
            <>
              <div ref={this.setMonthContainerRef} />
              <div ref={() => this.setMonthContainerRef(this.props.monthContainer)} />
            </>
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a destructured callback-ref handler invoked with a prop value", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const { setMonthContainerRef } = this;
          setMonthContainerRef(this.props.monthContainer);
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a destructured callback-ref handler is only used as a ref", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          const { setMonthContainerRef } = this;
          return (
            <>
              <div ref={this.setMonthContainerRef} />
              <div ref={setMonthContainerRef} />
            </>
          );
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `instance.monthContainer = value;`,
    `Object.assign(instance, { monthContainer: value });`,
  ])("still flags a competing writer through a this alias: %s", (competingWrite) => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        overrideMonthContainer = (value) => {
          const instance = this;
          ${competingWrite}
        };
        componentDidMount() {
          this.setState({ monthContainer: this.monthContainer });
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a nested post-mount update in disallow-in-func mode", () => {
    const result = runRule(
      noDidMountSetState,
      `
      import { Component } from "react";
      class Calendar extends Component {
        monthContainer = undefined;
        setMonthContainerRef = (element) => {
          this.monthContainer = element ?? undefined;
        };
        componentDidMount() {
          const updateMonthContainer = () => {
            this.setState({ monthContainer: this.monthContainer });
          };
          updateMonthContainer();
        }
        render() {
          return <div ref={this.setMonthContainerRef} />;
        }
      }
      `,
      {
        settings: {
          "react-doctor": {
            noDidMountSetState: { mode: "disallow-in-func" },
          },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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
