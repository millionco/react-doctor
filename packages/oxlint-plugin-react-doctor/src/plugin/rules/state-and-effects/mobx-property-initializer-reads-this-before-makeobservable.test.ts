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

  it("does not flag a field annotated action.bound (debounced handler reading this.props for config)", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { makeObservable, observable, action } from "mobx";
      import debounce from "lodash/debounce";
      class Form extends React.Component {
        @observable value = "";
        submit = debounce(() => this.doSubmit(), this.props.delayMs);
        constructor(props) {
          super(props);
          makeObservable(this, { value: observable, submit: action.bound });
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a field explicitly excluded with `false` in the annotation object", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { makeObservable, observable } from "mobx";
      class Tracker extends React.Component {
        @observable value = "";
        analytics = new Analytics(this.props.trackingId);
        constructor(props) {
          super(props);
          makeObservable(this, { value: observable, analytics: false });
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain field when makeObservable targets a local object, not `this`", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { makeObservable, observable } from "mobx";
      class Widget extends React.Component {
        items = this.props.items.slice();
        componentDidMount() {
          this.store = makeObservable({ items: [] }, { items: observable });
        }
        render() { return null; }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not leak annotation keys from a nested store class onto the outer component", () => {
    const result = runRule(
      mobxPropertyInitializerReadsThisBeforeMakeobservable,
      `
      import { makeObservable, observable } from "mobx";
      class Widget extends React.Component {
        items = this.props.items.slice();
        createStore() {
          class Store {
            items = [];
            constructor() {
              makeObservable(this, { items: observable });
            }
          }
          return new Store();
        }
        render() { return null; }
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
