import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { fbteeScopedJsxCompilerBailout } from "./fbtee-scoped-jsx-compiler-bailout.js";

describe("fbtee-scoped-jsx-compiler-bailout", () => {
  const withReactCompiler = { settings: { "react-doctor": { capabilities: ["react-compiler"] } } };
  const withoutReactCompiler = { settings: { "react-doctor": { capabilities: [] } } };

  it("reports scoped fbt JSX usage", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbt } from 'fbtee';
      
      export const Example = () => {
        const { fbt } = useFbt();
        return <fbt desc="test">Save</fbt>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("React Compiler will bail out");
  });

  it("reports scoped fbs JSX usage", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbs } from 'fbtee';
      
      export const Example = () => {
        const { fbs } = useFbs();
        return <fbs desc="test">Save</fbs>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports scoped fbt with renamed binding", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbt } from 'fbtee';
      
      export const Example = () => {
        const { fbt: translator } = useFbt();
        return <translator desc="test">Save</translator>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows global fbt import", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import fbt from 'fbtee';
      
      export const Example = () => {
        return <fbt desc="test">Save</fbt>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows scoped fbt when not used in JSX", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbt } from 'fbtee';
      
      export const Example = () => {
        const { fbt } = useFbt();
        return <div>No JSX usage here</div>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows fbt expression usage (already caught by React Compiler)", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbt } from 'fbtee';
      
      const helper = (fbt: any) => fbt._("test");
      
      export const Example = () => {
        const { fbt } = useFbt();
        return <div>{helper(fbt)}</div>;
      };
    `,
      withReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not run when React Compiler is not present", () => {
    const result = runRule(
      fbteeScopedJsxCompilerBailout,
      `
      import { useFbt } from 'fbtee';
      
      export const Example = () => {
        const { fbt } = useFbt();
        return <fbt desc="test">Save</fbt>;
      };
    `,
      withoutReactCompiler,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
