import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectMutationState } from "./no-direct-mutation-state.js";

describe("react-builtins/no-direct-mutation-state — regressions", () => {
  it("does not claim users see stale data when setState runs after the mutation", () => {
    const result = runRule(
      noDirectMutationState,
      `class Counter extends React.Component {
        increment() {
          this.state.count = this.state.count + 1;
          this.setState({ count: this.state.count });
        }
        render() { return <button onClick={() => this.increment()}>{this.state.count}</button>; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("stale data");
    expect(result.diagnostics[0].message).toContain("this.setState");
  });

  it("still flags a bare mutation outside the constructor", () => {
    const result = runRule(
      noDirectMutationState,
      `class Counter extends React.Component {
        increment() { this.state.count = this.state.count + 1; }
        render() { return <span>{this.state.count}</span>; }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
