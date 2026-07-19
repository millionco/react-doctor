import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

describe("react-builtins/no-did-update-set-state — regressions", () => {
  // docs-validation FP wave: the doc names the prop-comparison guard
  // (`if (prevProps.x !== this.props.x)`) as the React-sanctioned escape
  // hatch that cannot loop. Suppress diff-guarded setState calls.
  it("stays silent on a prop-comparison guard (prevProps diff)", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Input extends React.Component {
        componentDidUpdate(prevProps, prevState) {
          const { currentValue } = this.state;
          const { value } = this.props;
          if (currentValue !== value && prevProps.value !== value) {
            this.setState({ ...prevState, currentValue: value });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the resetKey error-boundary pattern", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class ErrorBoundary extends React.Component {
        componentDidUpdate(prevProps) {
          if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a prevState early-return plus prop-diff guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class ValueSelect extends React.Component {
        componentDidUpdate(prevProps, prevState) {
          if (this.state !== prevState) {
            return;
          }
          if (this.props.selected !== prevProps.selected) {
            this.setState({ selected: this.props.selected });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a truthy snapshot guard without a comparison", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Form extends React.Component {
        componentDidUpdate(_, prevState, snapshot) {
          if (snapshot.shouldUpdate) {
            const { nextState } = snapshot;
            this.setState(nextState);
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a diff of locals destructured from prevState/this.state", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class WelcomeScreen extends React.Component {
        componentDidUpdate(prevProps, prevState) {
          const { isKeyboardOpen: wasKeyboardOpen } = prevState.keyboard;
          const { isKeyboardOpen } = this.state.keyboard;
          if (wasKeyboardOpen !== isKeyboardOpen) {
            this.setState({ dialogWithKeyboardStyle: this.updateDialogStyle() });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an identity guard against this.state", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class MultiSchemaField extends React.Component {
        componentDidUpdate(prevProps, prevState) {
          let newState = this.state;
          if (!deepEquals(prevProps.options, this.props.options)) {
            newState = { retrievedOptions: compute(this.props.options) };
          }
          if (newState !== this.state) {
            this.setState(newState);
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a logical-AND diff guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate(prevProps) {
          this.props.value === undefined &&
            prevProps.value !== undefined &&
            this.setState({ selectedValue: undefined });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a transition guard with destructured previous props", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate({ value: previousValue }) {
          if (this.props.value === undefined && previousValue !== undefined) {
            this.setState({ selectedValue: undefined });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when every logical-OR branch is a historical transition", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate(prevProps) {
          if (
            (this.props.value === undefined && prevProps.value !== undefined) ||
            (this.props.mode === "closed" && prevProps.mode !== "closed")
          ) {
            this.setState({ selectedValue: undefined });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags destructured previous props from a different path", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate({ other: previousOther }) {
          if (this.props.value === undefined && previousOther !== undefined) {
            this.setState({ selectedValue: undefined });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when every logical-OR branch is a prop diff", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Profile extends React.Component {
        componentDidUpdate(prevProps) {
          if (
            prevProps.name !== this.props.name ||
            prevProps.email !== this.props.email
          ) {
            this.setState({ draft: this.props });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in the else branch of a prop equality guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Profile extends React.Component {
        componentDidUpdate(prevProps) {
          if (prevProps.name === this.props.name) {
            return;
          } else {
            this.setState({ draftName: this.props.name });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the else branch of a prop difference guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Profile extends React.Component {
        componentDidUpdate(prevProps) {
          if (prevProps.name !== this.props.name) {
            return;
          } else {
            this.setState({ updates: this.state.updates + 1 });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a previous prop compared only with a constant", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Counter extends React.Component {
        componentDidUpdate(prevProps) {
          if (prevProps.enabled !== true) {
            this.setState({ count: this.state.count + 1 });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a current prop local compared only with a constant", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Counter extends React.Component {
        componentDidUpdate() {
          const currentMode = this.props.mode;
          if (currentMode !== "ready") {
            this.setState({ count: this.state.count + 1 });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags constant comparisons for different prop paths", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate(prevProps) {
          if (this.props.value === undefined && prevProps.other !== undefined) {
            this.setState({ selectedValue: undefined });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a transition comparison behind an OR branch", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate(prevProps) {
          if (this.props.value !== prevProps.value || this.props.forceUpdate) {
            this.setState({ selectedValue: this.props.value });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags constant transition comparisons behind an OR branch", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Dropdown extends React.Component {
        componentDidUpdate(prevProps) {
          if (
            (this.props.value === undefined && prevProps.value !== undefined) ||
            this.props.forceUpdate
          ) {
            this.setState({ selectedValue: undefined });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent in an ES5 createReactClass component with a prop-diff guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      var Language = createReactClass({
        componentDidUpdate: function(prevProps) {
          if (this.props.ttsEngine.name !== prevProps.ttsEngine.name) {
            this.setState({ voices: [] });
          }
        }
      });
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an unconditional setState in componentDidUpdate", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Hello extends React.Component {
        componentDidUpdate(prevProps) {
          this.setState({ name: this.props.name.toUpperCase() });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a setState guarded by a non-diff condition", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Hello extends React.Component {
        componentDidUpdate() {
          if (true) {
            this.setState({ data: 123 });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a setState guarded only by a this.state truthiness check", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Hello extends React.Component {
        componentDidUpdate() {
          if (this.state.open) {
            this.setState({ data: 123 });
          }
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags setState when the `this` receiver is wrapped in `as any`", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Hello extends React.Component {
        componentDidUpdate() {
          (this as any).setState({ data: 123 });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a setState after (not inside) a diff guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Hello extends React.Component {
        componentDidUpdate(prevProps) {
          if (prevProps.name !== this.props.name) {
            log(prevProps.name);
          }
          this.setState({ data: 123 });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a convergent post-mount DOM text guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          const tooltip = this.durationNode.textContent;
          if (this.state.tooltip !== tooltip) {
            this.setState({ tooltip });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a direct convergent ref text guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          if (this.state.tooltip !== this.durationRef.current.textContent) {
            this.setState({ tooltip: this.durationRef.current.textContent });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a convergent DOM value passes through a formatter", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          const renderedText = this.durationNode.textContent;
          const tooltip = formatDuration(renderedText);
          if (this.state.tooltip !== tooltip) {
            this.setState({ tooltip });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a convergent DOM alias is declared inside a synchronous IIFE", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          (() => {
            const tooltip = this.durationNode.textContent;
            if (this.state.tooltip !== tooltip) {
              this.setState({ tooltip });
            }
          })();
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an optional-chained convergent DOM text guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          if (this.state?.tooltip !== this.durationNode?.textContent) {
            this.setState({ tooltip: this.durationNode?.textContent });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a post-mount guard that assigns a different value", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          const tooltip = this.durationNode.textContent;
          if (this.state.tooltip !== tooltip) {
            this.setState({ tooltip: this.otherNode.textContent });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a convergent render-known prop copy", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class FormattedDuration extends React.Component {
        componentDidUpdate() {
          if (this.state.tooltip !== this.props.tooltip) {
            this.setState({ tooltip: this.props.tooltip });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on the react-datepicker callback-ref convergence guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (
            this.props.showTimeSelect &&
            this.state.monthContainer !== this.monthContainer
          ) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return (
            <div ref={(div) => {
              this.monthContainer = div ?? undefined;
            }} />
          );
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the callback-ref comparison operands are reversed", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.monthContainer !== this.state.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for every field assigned by one callback ref", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.primaryContainer !== this.primaryContainer) {
            this.setState({ primaryContainer: this.primaryContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.primaryContainer = node;
            this.secondaryContainer = node;
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags callback-ref convergence behind an OR branch", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (
            this.state.monthContainer !== this.monthContainer ||
            this.props.forceUpdate
          ) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when every callback-ref OR branch converges", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (
            this.state.primaryContainer !== this.primaryContainer ||
            this.state.secondaryContainer !== this.secondaryContainer
          ) {
            this.setState({
              primaryContainer: this.primaryContainer,
              secondaryContainer: this.secondaryContainer,
            });
          }
        }

        render() {
          return <div ref={(node) => {
            this.primaryContainer = node;
            this.secondaryContainer = node;
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in the else branch of a callback-ref equality guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer === this.monthContainer) {
            this.measureContainer();
          } else {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the else branch of a callback-ref difference guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.measureContainer();
          } else {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["inline", "(node = null) => { this.monthContainer = node ?? undefined; }"],
    ["named", "this.setMonthContainer"],
  ])("stays silent on a %s callback ref with a default parameter", (_kind, refExpression) => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node = null) => {
          this.monthContainer = node ?? undefined;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={${refExpression}} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["plain", "this.monthContainer = undefined;"],
    ["compound", "this.monthContainer += node;"],
    ["update", "this.monthContainer++;"],
    ["delete", "delete this.monthContainer;"],
  ])("still flags callback-ref provenance after a later %s overwrite", (_kind, overwrite) => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.monthContainer = node;
            ${overwrite}
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags callback-ref provenance after an IIFE overwrite", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.monthContainer = node;
            (() => {
              this.monthContainer = undefined;
            })();
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps callback-ref provenance across a deferred nested overwrite", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.monthContainer = node;
            const clearContainer = () => {
              this.monthContainer = undefined;
            };
            registerCleanup(clearContainer);
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("restores callback-ref provenance with a final IIFE write", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.monthContainer = undefined;
            (() => {
              this.monthContainer = node;
            })();
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the final callback-ref write restores provenance", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => {
            this.monthContainer = undefined;
            this.monthContainer = node;
          }} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a named callback-ref convergence guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          this.monthContainer = node ?? undefined;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={this.setMonthContainer} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores static members when resolving a named callback ref", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        static setMonthContainer = null;

        setMonthContainer = (node) => {
          this.monthContainer = node ?? undefined;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={this.setMonthContainer} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "private field",
      "#setMonthContainer = (node) => { this.#monthContainer = node ?? undefined; };",
      "this.#setMonthContainer",
    ],
    [
      "private method",
      "#setMonthContainer(node) { this.#monthContainer = node ?? undefined; }",
      "this.#setMonthContainer",
    ],
    [
      "string-named method",
      '"setMonthContainer"(node) { this.#monthContainer = node ?? undefined; }',
      "this.setMonthContainer",
    ],
  ])("stays silent on callback-ref convergence using a %s", (_kind, handler, refExpression) => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        #monthContainer;

        ${handler}

        componentDidUpdate() {
          if (this.state.monthContainer !== this.#monthContainer) {
            this.setState({ monthContainer: this.#monthContainer });
          }
        }

        render() {
          return <div ref={${refExpression}} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "private provenance for a public field",
      `
        #node;
        #setNode = (node) => { this.#node = node; };
        componentDidUpdate() {
          if (this.state.node !== this.node) this.setState({ node: this.node });
        }
        render() { return <div ref={this.#setNode} />; }
      `,
    ],
    [
      "public provenance for a private field",
      `
        #node;
        setNode = (node) => { this.node = node; };
        componentDidUpdate() {
          if (this.state.node !== this.#node) this.setState({ node: this.#node });
        }
        render() { return <div ref={this.setNode} />; }
      `,
    ],
  ])("still flags %s with the same spelling", (_description, classBody) => {
    const result = runRule(
      noDidUpdateSetState,
      `class Calendar extends React.Component { ${classBody} }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a private handler separately from a same-named public handler", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        #node;
        setNode = (node) => { this.publicNode = node; };
        #setNode = (node) => { this.#node = node; };

        componentDidUpdate() {
          if (this.state.node !== this.#node) this.setState({ node: this.#node });
        }

        render() { return <div ref={this.#setNode} />; }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a conditional named callback-ref convergence guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer(node) {
          this.monthContainer = node;
        }

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={this.props.enabled ? this.setMonthContainer : null} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["logical AND", "this.props.enabled && this.setMonthContainer"],
    ["logical OR", "this.props.forwardedRef || this.setMonthContainer"],
  ])("stays silent on a %s callback-ref convergence guard", (_description, refExpression) => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          this.monthContainer = node;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={${refExpression}} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapped callback nested in a logical ref expression", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          this.monthContainer = node;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={this.props.enabled && wrap(this.setMonthContainer)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback that cannot be selected from the left side of logical AND", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          this.monthContainer = node;
        };

        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={this.setMonthContainer && this.props.forwardedRef} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a second convergence branch clears the ref state", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.props.enabled && this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
          if (!this.props.enabled && this.state.monthContainer) {
            this.setState({ monthContainer: undefined });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node ?? undefined)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an ordinary class field without callback-ref provenance", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          this.monthContainer = getMutableValue();
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref field reassigned during componentDidUpdate", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          this.monthContainer = getMutableValue();
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref guard that assigns a different expression", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.otherContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback-ref guard that assigns a different state field", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ otherContainer: this.monthContainer });
          }
        }

        render() {
          return <div ref={(node) => (this.monthContainer = node)} />;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a truthy prevProps guard without a comparison", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Counter extends React.Component {
        componentDidUpdate(prevProps) {
          if (prevProps.enabled) {
            this.setState({ count: this.state.count + 1 });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a negated state guard that writes undefined", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (!this.state.monthContainer) {
            this.setState({ monthContainer: undefined });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an undefined clear in the else branch of a truthy state guard", () => {
    const result = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        componentDidUpdate() {
          if (this.state.monthContainer) {
            this.measureContainer();
          } else {
            this.setState({ monthContainer: undefined });
          }
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects transformed and shadowed named callback-ref values", () => {
    const transformed = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          this.monthContainer = normalize(node);
        };
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }
        render() {
          return <div ref={this.setMonthContainer} />;
        }
      }
      `,
    );
    const shadowed = runRule(
      noDidUpdateSetState,
      `
      class Calendar extends React.Component {
        setMonthContainer = (node) => {
          {
            const node = getFallback();
            this.monthContainer = node;
          }
        };
        componentDidUpdate() {
          if (this.state.monthContainer !== this.monthContainer) {
            this.setState({ monthContainer: this.monthContainer });
          }
        }
        render() {
          return <div ref={this.setMonthContainer} />;
        }
      }
      `,
    );

    expect(transformed.parseErrors).toEqual([]);
    expect(transformed.diagnostics).toHaveLength(1);
    expect(shadowed.parseErrors).toEqual([]);
    expect(shadowed.diagnostics).toHaveLength(1);
  });
});
