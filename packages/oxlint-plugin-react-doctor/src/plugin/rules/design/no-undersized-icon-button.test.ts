import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUndersizedIconButton } from "./no-undersized-icon-button.js";

describe("no-undersized-icon-button", () => {
  it("reports an explicitly undersized Tailwind icon button", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const Close = () => <button aria-label="Close" className="size-4 p-0"><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an explicitly undersized inline icon button", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const Close = () => <button aria-label="Close" style={{ width: 20, height: 20, padding: 0 }}><svg /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a target that is undersized on one axis", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const Close = () => <button aria-label="Close" style={{ width: 24, height: 20, padding: 0 }}><svg /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows targets at the minimum size or with padding", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button aria-label="Close" className="size-6 p-0"><CloseIcon /></button>;
       const B = () => <button aria-label="Close" className="size-4 p-2"><CloseIcon /></button>;
       const C = () => <button aria-label="Close" style={{ width: 20, height: 20, padding: 4 }}><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for equal-priority size and padding conflicts", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button aria-label="Close" className="size-4 size-6 p-0"><CloseIcon /></button>;
       const B = () => <button aria-label="Close" className="size-6 size-4 p-0"><CloseIcon /></button>;
       const C = () => <button aria-label="Close" className="w-4 w-6 h-4 p-0"><CloseIcon /></button>;
       const D = () => <button aria-label="Close" className="size-4 p-0 p-2"><CloseIcon /></button>;
       const E = () => <button aria-label="Close" className="!size-4 size-6! p-0"><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors one unambiguous important target utility", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button aria-label="Close" className="size-6 !size-4 p-0"><CloseIcon /></button>;
       const B = () => <button aria-label="Close" className="size-4 !size-6 p-0"><CloseIcon /></button>;
       const C = () => <button aria-label="Close" className="!size-6 p-0" style={{ width: 20, height: 20, padding: 0 }}><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not fall back to class sizing when inline target styles are inconclusive", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button aria-label="Close" className="size-4 p-0" style={{ width: 20, height: 20, padding: 4 }}><CloseIcon /></button>;
       const B = ({ padding }) => <button aria-label="Close" className="size-4 p-0" style={{ width: 20, height: 20, padding }}><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses class sizing when inline style does not affect the target box", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const Close = () => <button aria-label="Close" className="size-4 p-0" style={{ color: "red" }}><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only interprets class sizing when Tailwind is available", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button aria-label="Close" className="size-4 p-0"><CloseIcon /></button>;
       const B = () => <button aria-label="Close" style={{ width: 20, height: 20, padding: 0 }}><CloseIcon /></button>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows visible labels and expanded pseudo-element targets", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <button className="size-4 p-0"><CloseIcon /> Close</button>;
       const B = () => <button aria-label="Close" className="relative size-4 p-0 before:absolute before:-inset-2"><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not confuse arbitrary content with a pseudo-element variant", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const Close = () => <button aria-label="Close" className="size-4 p-0 [--label:'before:']"><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips custom buttons and unresolved dimensions", () => {
    const result = runRule(
      noUndersizedIconButton,
      `const A = () => <IconButton className="size-4 p-0"><CloseIcon /></IconButton>;
       const B = () => <button aria-label="Close" className="compact"><CloseIcon /></button>;
       const C = ({ props }) => <button aria-label="Close" className="size-4 p-0" {...props}><CloseIcon /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
