import { describe, expect, it } from "vite-plus/test";
import { defineRule } from "./define-rule.js";

describe("defineRule", () => {
  it("skips test-noise rules before React JSX dialect setup", () => {
    let didCreateVisitors = false;
    const rule = defineRule({
      id: "test-noise-react-jsx-rule",
      title: "test",
      severity: "warn",
      tags: ["test-noise", "react-jsx-only"],
      create: () => {
        didCreateVisitors = true;
        return { JSXOpeningElement: () => {} };
      },
    });

    const visitors = rule.create({
      filename: "component.test.tsx",
      report: () => {},
      get scopes(): never {
        throw new Error("scopes should stay lazy");
      },
      get cfg(): never {
        throw new Error("cfg should stay lazy");
      },
    });

    expect(didCreateVisitors).toBe(false);
    expect(visitors).toEqual({});
  });

  it("keeps React JSX dialect setup in production files", () => {
    let didCreateVisitors = false;
    const rule = defineRule({
      id: "production-react-jsx-rule",
      title: "test",
      severity: "warn",
      tags: ["test-noise", "react-jsx-only"],
      create: () => {
        didCreateVisitors = true;
        return { JSXOpeningElement: () => {} };
      },
    });

    const visitors = rule.create({
      filename: "component.tsx",
      report: () => {},
      get scopes(): never {
        throw new Error("scopes should stay lazy");
      },
      get cfg(): never {
        throw new Error("cfg should stay lazy");
      },
    });

    expect(didCreateVisitors).toBe(true);
    expect(visitors.Program).toBeTypeOf("function");
    expect(visitors.JSXOpeningElement).toBeTypeOf("function");
  });

  it("keeps capability-gated rules compatible when capabilities are unspecified", () => {
    const rule = defineRule({
      id: "compiler-disabled-rule",
      title: "test",
      severity: "warn",
      disabledWhen: ["react-compiler"],
      create: () => ({ Program: () => {} }),
    });

    const visitors = rule.create({
      report: () => {},
      get scopes(): never {
        throw new Error("scopes should stay lazy");
      },
      get cfg(): never {
        throw new Error("cfg should stay lazy");
      },
    });

    expect(visitors.Program).toBeTypeOf("function");
  });

  it("skips rules disabled by an explicitly configured capability", () => {
    const rule = defineRule({
      id: "compiler-disabled-rule",
      title: "test",
      severity: "warn",
      disabledWhen: ["react-compiler"],
      create: () => ({ Program: () => {} }),
    });

    const visitors = rule.create({
      report: () => {},
      settings: { "react-doctor": { capabilities: ["react-compiler"] } },
      get scopes(): never {
        throw new Error("scopes should stay lazy");
      },
      get cfg(): never {
        throw new Error("cfg should stay lazy");
      },
    });

    expect(visitors).toEqual({});
  });
});
