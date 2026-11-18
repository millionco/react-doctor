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

  it.each([
    '<textarea className="resize-none" style={{ fieldSizing: "content" }} />',
    '<textarea className="field-sizing-content" style={{ resize: "none" }} />',
    '<textarea className="resize-none" style={{ fieldSizing: "fixed", fieldSizing: "content" }} />',
    '<textarea className="resize-none rounded-md p-2" style={{ color: "red", fieldSizing: "content" }} />',
    '<textarea className="field-sizing-content rounded-md" style={{ borderWidth: 1, resize: "none" }} />',
  ])("allows mixed literal content sizing: %s", (markup) => {
    const result = runRule(noNonresizableTextarea, `const Editor = () => ${markup};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "inline fixed sizing overrides the class",
      '<textarea className="field-sizing-content" style={{ resize: "none", fieldSizing: "fixed" }} />',
    ],
    [
      "a later fixed property replaces content sizing",
      '<textarea className="resize-none" style={{ fieldSizing: "content", fieldSizing: "fixed" }} />',
    ],
    [
      "a late spread may replace the inline field sizing",
      '<textarea className="resize-none" style={{ fieldSizing: "content", ...extra }} />',
    ],
    [
      "an early spread may still set a height",
      '<textarea className="resize-none" style={{ ...extra, fieldSizing: "content" }} />',
    ],
    [
      "a computed property might supply field sizing",
      '<textarea className="field-sizing-content" style={{ [key]: "fixed", resize: "none" }} />',
    ],
    [
      "an unrelated getter could modify the style object",
      '<textarea className="field-sizing-content" style={{ get color() { this.fieldSizing = "fixed"; return "red"; }, resize: "none" }} />',
    ],
    [
      "a later JSX style attribute replaces the apparent content sizing",
      '<textarea className="resize-none" style={{ fieldSizing: "content" }} style={{ fieldSizing: "fixed" }} />',
    ],
    [
      "a later JSX class replaces the apparent content sizing",
      '<textarea className="field-sizing-content" className="field-sizing-fixed" style={{ resize: "none" }} />',
    ],
    [
      "the content-sizing class is dynamic",
      '<textarea className={className} style={{ resize: "none" }} />',
    ],
    [
      "content sizing is responsive-only",
      '<textarea className="md:field-sizing-content" style={{ resize: "none" }} />',
    ],
    [
      "an important responsive utility can override inline content sizing",
      '<textarea className="resize-none md:field-sizing-fixed!" style={{ fieldSizing: "content" }} />',
    ],
    [
      "conflicting class utilities can fix the field size",
      '<textarea className="field-sizing-content field-sizing-fixed" style={{ resize: "none" }} />',
    ],
    [
      "an arbitrary property can fix the field size",
      '<textarea className="resize-none [field-sizing:fixed]!" style={{ fieldSizing: "content" }} />',
    ],
    [
      "an inline height constrains content sizing",
      '<textarea className="resize-none" style={{ height: "4rem", fieldSizing: "content" }} />',
    ],
    [
      "a responsive size utility constrains growth",
      '<textarea className="field-sizing-content sm:size-16" style={{ resize: "none" }} />',
    ],
    [
      "a template line continuation can join two apparent class tokens",
      '<textarea className={`prefix\\\nfield-sizing-content`} style={{ resize: "none" }} />',
    ],
    [
      "non-ASCII whitespace is part of the actual class token",
      '<textarea className={"field-sizing-content\\u00a0"} style={{ resize: "none" }} />',
    ],
  ])("keeps the warning when %s", (_description, markup) => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = ({ className, extra, key }) => ${markup};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips custom, dynamic, and spread-owned controls", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = ({ className, props }) => <><Textarea className="resize-none" /><textarea className={className} /><textarea className="resize-none" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
