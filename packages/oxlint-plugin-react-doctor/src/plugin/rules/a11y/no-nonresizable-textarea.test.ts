import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonresizableTextarea } from "./no-nonresizable-textarea.js";

describe("no-nonresizable-textarea", () => {
  it("reports static class and inline resize suppression", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-none" /><textarea style={{ resize: "none" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows vertical, block, and responsive-only policies", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-y" /><textarea style={{ resize: "block" }} /><textarea className="md:resize-none resize-y" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows content-sized textareas", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-none field-sizing-content" /><textarea style={{ resize: "none", fieldSizing: "content" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips custom, dynamic, and spread-owned controls", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = ({ className, props }) => <><Textarea className="resize-none" /><textarea className={className} /><textarea className="resize-none" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
