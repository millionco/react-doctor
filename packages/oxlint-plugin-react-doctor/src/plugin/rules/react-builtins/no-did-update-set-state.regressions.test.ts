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

  it("stays silent on a snapshot-driven guard (getSnapshotBeforeUpdate)", () => {
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
    expect(result.diagnostics).toEqual([]);
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
});
