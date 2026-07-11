import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noReact19DeprecatedApis } from "./no-react19-deprecated-apis.js";

const run = (code: string) =>
  runRule(noReact19DeprecatedApis, code, {
    filename: "src/features/profile/profile-card.tsx",
  });

describe("architecture/no-react19-deprecated-apis — regressions", () => {
  it("does not report forwardRef, which remains supported in React 19", () => {
    const result = run(`
      import React, { forwardRef as createInput } from "react";
      const Input = createInput((props, ref) => <input ref={ref} {...props} />);
      const Button = React.forwardRef((props, ref) => <button ref={ref} {...props} />);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the removed createFactory named import", () => {
    const result = run(`
      import { createFactory } from "react";
      const createButton = createFactory("button");
    `);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("createFactory");
  });

  it("reports a renamed createFactory import by its canonical imported name", () => {
    const result = run(`
      import { createFactory as makeLegacyElement } from "react";
      const createButton = makeLegacyElement("button");
    `);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("createFactory");
  });

  it("reports createFactory on namespace and default React imports once", () => {
    const result = run(`
      import React from "react";
      import * as ReactNamespace from "react";
      const createButton = React.createFactory("button");
      const createInput = ReactNamespace.createFactory("input");
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports createFactory through immutable React namespace aliases", () => {
    const result = run(`
      import * as React from "react";
      const ReactAlias = React;
      const WrappedReactAlias = ReactAlias as typeof ReactAlias;
      const createButton = WrappedReactAlias.createFactory("button");
      void createButton;
    `);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("createFactory");
  });

  it("does not trust mutable React namespace aliases", () => {
    const result = run(`
      import * as React from "react";
      const Compat = { createFactory: (tag) => tag };
      let ReactAlias = React;
      ReactAlias = Compat;
      const createButton = ReactAlias.createFactory("button");
      void createButton;
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("does not report a shadowed React namespace binding", () => {
    const result = run(`
      import * as React from "react";
      const build = (React) => React.createFactory("button");
      void build;
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports the imported namespace outside a shadowed scope", () => {
    const result = run(`
      import * as React from "react";
      const build = (React) => React.createFactory("button");
      const createInput = React.createFactory("input");
      void build;
      void createInput;
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not report same-named APIs from non-React modules or local objects", () => {
    const result = run(`
      import { createFactory } from "preact/compat";
      import * as Compat from "preact/compat";
      const React = { createFactory: (tag) => tag };
      void createFactory;
      void Compat.createFactory;
      void React.createFactory;
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("does not report type-only imports or computed member access", () => {
    const result = run(`
      import type { createFactory } from "react";
      import * as React from "react";
      type Factory = typeof createFactory;
      const createButton = React["createFactory"];
      void createButton;
    `);

    expect(result.diagnostics).toEqual([]);
  });
});
