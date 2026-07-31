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
});
