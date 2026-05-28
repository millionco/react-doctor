import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateContextInRender } from "./no-create-context-in-render.js";

describe("no-create-context-in-render", () => {
  it("flags createContext inside a PascalCase function component", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      function App() {
        const Ctx = createContext(null);
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("App");
  });

  it("flags createContext inside an arrow component", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      const Page = () => {
        const PageCtx = createContext(null);
        return null;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Page");
  });

  it("flags React.createContext through the canonical namespace import", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import * as React from "react";

      function App() {
        const Ctx = React.createContext("default");
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags createContext inside a custom hook", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      function useStore() {
        const Ctx = createContext({});
        return Ctx;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useStore");
  });

  it("flags createContext when imported under a rename", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext as makeCtx } from "react";

      function App() {
        const Ctx = makeCtx(null);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag createContext at module scope", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      export const Ctx = createContext(null);

      function App() {
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag createContext inside a plain (non-component) helper", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      function makeContextFactory() {
        return createContext(null);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags createContext from use-context-selector (same identity bug)", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "use-context-selector";

      function App() {
        const Ctx = createContext(null);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags createContext from react-tracked", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react-tracked";

      function App() {
        const Ctx = createContext(null);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a createContext from an unrecognized module", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "my-custom-context-lib";

      function App() {
        const Ctx = createContext(null);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag locally-defined createContext functions", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      function createContext(value) {
        return { value };
      }

      function App() {
        const Ctx = createContext(null);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag createContext inside an event handler", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { createContext } from "react";

      function App() {
        const onClick = () => {
          const Ctx = createContext(null);
          return Ctx;
        };
        return null;
      }
    `,
    );

    // The handler doesn't run on render, so the Context isn't recreated
    // every render — no identity-stability bug to report.
    expect(result.diagnostics).toEqual([]);
  });

  it("flags createContext inside a memo()-wrapped arrow component", () => {
    const result = runRule(
      noCreateContextInRender,
      `
      import { memo, createContext } from "react";

      const App = memo(() => {
        const Ctx = createContext(null);
        return null;
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("App");
  });
});
