import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxPropertyInitializerReadsThisBeforeMakeobservable } from "./mobx-property-initializer-reads-this-before-makeobservable.js";

describe("mobx-property-initializer-reads-this-before-makeobservable", () => {
  it("flags an @observable field initialized from this.props.map(...)", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class SendTemplate extends React.Component {
        @observable checkedItems = this.props.checklist.map((item) => item.id);
        constructor(props) {
          super(props);
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an @observable field constructed with this.props.X", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class Tokens extends React.Component {
        @observable.ref tokensViewState = new ViewState(parse(this.props.location.search));
        constructor(props) {
          super(props);
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a field named as a key in makeObservable annotations", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class C extends React.PureComponent {
        items = this.props.items.map((x) => x);
        constructor(props) {
          super(props);
          makeObservable(this, { items: observable });
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-observable helper field reading this.props", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class C extends React.Component {
        @observable count = 0;
        private helper = new Helper(this.props.config);
        constructor(props) {
          super(props);
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an observable field whose initializer does not read this", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class C extends React.Component {
        @observable count = 0;
        constructor(props) {
          super(props);
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type-only field with no initializer (the fixed form)", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class C extends React.Component {
        @observable tokensViewState: ViewState<ITokens>;
        constructor(props) {
          super(props);
          makeObservable(this);
          this.tokensViewState = new ViewState(parse(this.props.location.search));
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain React class that never calls makeObservable", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      class C extends React.Component {
        items = this.props.items;
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an @observable field whose this.props read is lazy inside a function", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class C extends React.Component {
        @observable getItems = () => this.props.items;
        constructor(props) {
          super(props);
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-React class (plain MobX store)", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { observable, makeObservable } from "mobx";
      class Store {
        @observable data = this.props.data;
        constructor() {
          makeObservable(this);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
