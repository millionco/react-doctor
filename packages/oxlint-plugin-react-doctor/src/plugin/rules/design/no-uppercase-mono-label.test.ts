import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUppercaseMonoLabel } from "./no-uppercase-mono-label.js";

describe("no-uppercase-mono-label", () => {
  it("flags a short uppercase monospace eyebrow", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Hero = () => <span className="font-mono text-xs uppercase tracking-widest">System online</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts code content, untracked type badges, and ordinary monospace values", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Metadata = () => <><code className="font-mono uppercase tracking-widest">GET</code><span className="font-mono uppercase">ARRAY</span><span className="font-mono">a8f92c</span><span className="uppercase">Status</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic identifiers without static label text", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Identifier = ({ value }) => <span className="font-mono uppercase tracking-widest">{value}</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores partially static labels containing a dynamic identifier", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Identifier = ({ value }) => <span className="font-mono uppercase tracking-widest">ID: {value}</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
