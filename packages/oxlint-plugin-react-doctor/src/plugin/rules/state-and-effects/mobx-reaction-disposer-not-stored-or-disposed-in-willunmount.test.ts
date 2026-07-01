import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxReactionDisposerNotStoredOrDisposedInWillunmount } from "./mobx-reaction-disposer-not-stored-or-disposed-in-willunmount.js";

describe("mobx-reaction-disposer-not-stored-or-disposed-in-willunmount", () => {
  it("flags a field-initializer reaction disposed in componentWillUnmount", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "mobx";
      class MoneyInput extends React.Component {
        private fieldReaction = reaction(() => this.props.value, (v) => this.sync(v));
        componentWillUnmount() {
          this.fieldReaction();
        }
        render() { return null; }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a field-initializer autorun in a PureComponent", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { autorun } from "mobx";
      class C extends React.PureComponent {
        disposer = autorun(() => this.render());
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a field-initializer when() in a Component class", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { when } from "mobx";
      class C extends Component {
        disposer = when(() => this.ready, () => this.load());
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a reaction created in componentDidMount and stored on this", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "mobx";
      class C extends React.Component {
        componentDidMount() {
          this.disposer = reaction(() => this.props.value, () => {});
        }
        componentWillUnmount() {
          this.disposer();
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a field-initializer wrapped in disposeOnUnmount", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "mobx";
      import { disposeOnUnmount } from "mobx-react";
      class C extends React.Component {
        disposer = disposeOnUnmount(this, reaction(() => this.props.value, () => {}));
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a field-initializer reaction in a plain MobX store class", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "mobx";
      class UserStore {
        disposer = reaction(() => this.value, () => {});
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reaction inside a functional component's useEffect cleanup", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "mobx";
      const C = () => {
        useEffect(() => {
          const dispose = reaction(() => store.value, () => {});
          return () => dispose();
        }, []);
        return null;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a field-initializer reaction not imported from mobx", () => {
    const result = runRule(
      mobxReactionDisposerNotStoredOrDisposedInWillunmount,
      `
      import { reaction } from "./local-helpers";
      class C extends React.Component {
        disposer = reaction(() => this.props.value, () => {});
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
