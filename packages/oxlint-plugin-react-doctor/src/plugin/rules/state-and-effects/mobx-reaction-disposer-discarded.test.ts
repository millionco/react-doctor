import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxReactionDisposerDiscarded } from "./mobx-reaction-disposer-discarded.js";

describe("mobx-reaction-disposer-discarded", () => {
  it("flags a bare reaction() whose disposer is discarded", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      class Store {
        constructor() {
          reaction(() => this.value, (value) => Storage.local.set("v", value));
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare autorun() whose disposer is discarded", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class ViewState {
        start() {
          autorun(this.loadImages);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a reaction imported under an alias", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction as react } from "mobx";
      react(() => this.value, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the disposer is passed to disposeOnUnmount", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      import { disposeOnUnmount } from "mobx-react";
      class C {
        componentDidMount() {
          disposeOnUnmount(this, reaction(() => this.value, () => {}));
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the disposer is stored in a variable", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      const dispose = reaction(() => this.value, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the disposer is assigned to a field", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class C {
        start() {
          this.disposer = autorun(() => this.value);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare when() call (auto-disposes after firing once)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { when } from "mobx";
      class C {
        start() {
          when(() => this.ready, () => this.run());
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Yup schema.when() (MemberExpression callee)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import * as yup from "yup";
      const schema = yup.object({ a: yup.string() });
      schema.when("b", { is: true, then: (s) => s.required() });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag IntersectionObserver.observe (MemberExpression callee)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      const io = new IntersectionObserver(cb);
      io.observe(element);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local reaction() not imported from mobx", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      const reaction = (fn, effect) => {};
      reaction(() => 1, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reaction imported from an unrelated module", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "@storybook/test";
      reaction(() => 1, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
