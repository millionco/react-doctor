import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTruthinessGuardOnReactnodeContentSlot } from "./no-truthiness-guard-on-reactnode-content-slot.js";

describe("no-truthiness-guard-on-reactnode-content-slot", () => {
  it("flags if (!extra) return null on an interface-typed ReactNode slot", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `interface ResultProps { extra?: React.ReactNode }
       const Result = ({ extra }: ResultProps) => {
         if (!extra) return null;
         return <div className="ant-result-extra">{extra}</div>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline && guard on an inline ReactNode slot", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const ProgressInnerText = ({ text }: { text?: React.ReactNode }) => (
         <>{text && <span className="inner">{text}</span>}</>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary render-pick on a ReactNode slot", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Slot = ({ content }: { content?: ReactNode }) =>
         content ? <div>{content}</div> : null;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare ReactNode union with null", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Slot = ({ label }: { label: React.ReactNode | null }) => {
         if (!label) return null;
         return <span>{label}</span>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a typed parameter of ReactNode", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const render = (extra: React.ReactNode) => (extra ? <div>{extra}</div> : null);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the operand is declared string", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const TreeFile = ({ extra }: { extra?: string }) =>
         extra ? <span>{extra}</span> : null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a string title && guard", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Card = ({ title }: { title?: string }) => (
         <div>{title && <h3>{title}</h3>}</div>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a ReactElement slot", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Tooltip = ({ content }: { content?: React.ReactElement }) =>
         content ? <div>{content}</div> : null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the operand type cannot be resolved (inferred helper result)", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Slot = ({ title }) => {
         const propValue = getRenderPropValue(title);
         if (!propValue) return null;
         return <span>{propValue}</span>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a numeric && leak (count is number-typed)", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const Badge = ({ count }: { count?: number }) => <>{count && <span>{count}</span>}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a same-named binding is a plain untyped local", () => {
    const result = runRule(
      noTruthinessGuardOnReactnodeContentSlot,
      `const extra = compute();
       const view = extra ? <div>{extra}</div> : null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
