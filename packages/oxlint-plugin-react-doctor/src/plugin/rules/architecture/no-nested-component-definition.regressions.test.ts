import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNestedComponentDefinition } from "./no-nested-component-definition.js";
import { noUnstableNestedComponents } from "../react-builtins/no-unstable-nested-components.js";

const run = (code: string) =>
  runRule(noNestedComponentDefinition, code, { filename: "fixture.tsx" });

const messagesOf = (result: { diagnostics: Array<{ message: string }> }) =>
  result.diagnostics.map((diagnostic) => diagnostic.message);

describe("architecture/no-nested-component-definition — regressions", () => {
  it("shares one severity with no-unstable-nested-components (same defect class)", () => {
    expect(noNestedComponentDefinition.severity).toBe("warn");
    expect(noNestedComponentDefinition.severity).toBe(noUnstableNestedComponents.severity);
  });

  it("flags a nested component that is rendered as JSX", () => {
    const result = run(`
      const Parent = () => {
        const NestedChild = () => <span>nested</span>;
        return <NestedChild />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a nested PascalCase render helper only called inline", () => {
    const result = run(`
      const Settings = () => {
        const GeneralSection = () => <div>general</div>;
        return <div>{GeneralSection()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // Devin: rendered-JSX membership must be scoped to the candidate's own
  // enclosing component. A sibling rendering `<Inner/>` must not make a
  // same-named call-only helper in another parent a false positive.
  it("does not leak a sibling's <Inner/> onto a same-named call-only helper", () => {
    const result = run(`
      const Parent1 = () => {
        const Inner = () => <span>call-only</span>;
        return <div>{Inner()}</div>;
      };
      const Parent2 = () => {
        const Inner = () => <span>rendered</span>;
        return <Inner />;
      };
    `);
    // Only Parent2's rendered Inner is a genuine nested component; Parent1's
    // is inlined via a plain call and must stay quiet.
    expect(result.diagnostics).toHaveLength(1);
  });

  // fp-review PR 996: nested components rendered only by reference through a
  // component prop (`component={Inner}`, `ItemComponent={Row}`) still create
  // a fresh element type on every render and must be flagged.
  it("flags a nested arrow component passed by reference as component={Inner}", () => {
    const result = run(`
      const Parent = () => {
        const Inner = () => <span/>;
        return <Route path="/x" component={Inner} />;
      };
    `);
    expect(messagesOf(result)).toEqual([
      'Your users lose all state in "Inner" on every render because it\'s defined inside "Parent", so move it out to the top of the file.',
    ]);
  });

  it("flags a nested function-declaration component passed as ItemComponent={Row}", () => {
    const result = run(`
      const Parent = ({ items }) => {
        function Row() { return <li/>; }
        return <List items={items} ItemComponent={Row} />;
      };
    `);
    expect(messagesOf(result)).toEqual([
      'Your users lose all state in "Row" on every render because it\'s defined inside "Parent", so move it out to the top of the file.',
    ]);
  });

  // fp-review PR 996: the harness dispatches `<NodeType>:exit` like production
  // oxlint, so the componentStack pops between sibling declarations and every
  // rendered sibling records the correct enclosing component.
  it("flags both rendered nested siblings independently", () => {
    const result = run(`
      const Parent = () => {
        const Icon = () => <i/>;
        const Row = () => <li/>;
        return <div><Icon/><Row/></div>;
      };
    `);
    expect(messagesOf(result)).toEqual([
      'Your users lose all state in "Icon" on every render because it\'s defined inside "Parent", so move it out to the top of the file.',
      'Your users lose all state in "Row" on every render because it\'s defined inside "Parent", so move it out to the top of the file.',
    ]);
  });

  it("flags only the rendered sibling when a call-only helper precedes it", () => {
    const result = run(`
      const Parent = () => {
        const RenderIcon = () => <i/>;
        const Row = () => <li/>;
        return <div>{RenderIcon()}<Row/></div>;
      };
    `);
    expect(messagesOf(result)).toEqual([
      'Your users lose all state in "Row" on every render because it\'s defined inside "Parent", so move it out to the top of the file.',
    ]);
  });

  it("stays silent on a capitalized call-only helper never rendered or referenced", () => {
    const result = run(`
      const Screen = () => {
        const RenderIcon = () => <i/>;
        return <div>{RenderIcon()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
