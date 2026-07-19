import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxNoMakeAutoObservableInInheritance } from "./mobx-no-make-auto-observable-in-inheritance.js";

const diagnosticsFor = (source: string): number =>
  runRule(mobxNoMakeAutoObservableInInheritance, source).diagnostics.length;

describe("mobx-no-make-auto-observable-in-inheritance", () => {
  it("reports direct subclasses with named, aliased, and namespace imports", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable, makeAutoObservable as auto } from "mobx";
        import * as mobx from "mobx";
        class A extends Base { constructor() { super(); makeAutoObservable(this); } }
        class B extends Base { constructor() { super(); auto(this); } }
        class C extends Base { constructor() { super(); mobx.makeAutoObservable(this); } }
      `),
    ).toBe(3);
  });

  it("reports a base class extended later in the same file", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        class Base {
          constructor() { makeAutoObservable(this); }
        }
        class Child extends Base {}
      `),
    ).toBe(1);
  });

  it("reports a base class extended through an immutable alias", () => {
    expect(
      diagnosticsFor(`
        import * as mobx from "mobx";
        const { makeAutoObservable: auto } = mobx;
        class Base { constructor() { auto(this); } }
        const Parent = Base;
        class Child extends Parent {}
      `),
    ).toBe(1);
  });

  it("reports assigned anonymous base classes extended in the same file", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        const Base = class { constructor() { makeAutoObservable(this); } };
        class Child extends Base {}
      `),
    ).toBe(1);
  });

  it("follows immutable aliases of the MobX function and namespace", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        import * as mobx from "mobx";
        const auto = makeAutoObservable;
        const api = mobx;
        class A extends Base { constructor() { super(); auto(this); } }
        class B extends Base { constructor() { super(); api.makeAutoObservable(this); } }
      `),
    ).toBe(2);
  });

  it("does not report standalone classes, makeObservable, or another target", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable, makeObservable } from "mobx";
        class Standalone { constructor(other) { makeAutoObservable(other); } }
        class Explicit extends Base { constructor() { super(); makeObservable(this); } }
      `),
    ).toBe(0);
  });

  it("does not report shadowed, mutable, or userland functions", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        let auto = makeAutoObservable;
        auto = customAuto;
        class A extends Base {
          constructor(makeAutoObservable) {
            super();
            makeAutoObservable(this);
            auto(this);
          }
        }
        function customAuto() {}
        class B extends Base { constructor() { super(); customAuto(this); } }
      `),
    ).toBe(0);
  });

  it("does not treat calls in methods or nested callbacks as constructor setup", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        class Store extends Base {
          constructor() {
            super();
            queueMicrotask(() => makeAutoObservable(this));
          }
          setup() { makeAutoObservable(this); }
        }
      `),
    ).toBe(0);
  });

  it("does not treat extends null as class inheritance", () => {
    expect(
      diagnosticsFor(`
        import { makeAutoObservable } from "mobx";
        class Store extends null {
          constructor() { return Object.create(Store.prototype); }
          setup() { makeAutoObservable(this); }
        }
      `),
    ).toBe(0);
  });
});
