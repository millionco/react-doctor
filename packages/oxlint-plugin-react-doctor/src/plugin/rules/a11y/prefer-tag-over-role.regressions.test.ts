import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferTagOverRole } from "./prefer-tag-over-role.js";

describe("a11y/prefer-tag-over-role regressions", () => {
  it('does not suggest a tag for `<div role="group">` (would map to the nonsensical <address>)', () => {
    const result = runRule(preferTagOverRole, `const Group = () => <div role="group" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest a tag for `<div role="region">` (<section> only when named)', () => {
    const result = runRule(preferTagOverRole, `const Region = () => <div role="region" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <option> for `<div role="option">` (native option needs a <select> parent, text-only)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Opt = () => <div role="option">{label}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <img> for `<span role="img">` (img is a void element; cannot wrap children)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Icon = () => <span role="img" aria-label="busy"><Spinner /></span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <dialog> for `<div role="dialog">` (top-layer/showModal semantics)', () => {
    const result = runRule(preferTagOverRole, `const D = () => <div role="dialog" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <output> for `<div role="status">` (output is form-result-specific)', () => {
    const result = runRule(preferTagOverRole, `const S = () => <div role="status" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still suggests a tag for a role with a clean native equivalent", () => {
    const result = runRule(preferTagOverRole, `const Nav = () => <div role="navigation" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still suggests <button> for `<div role="button">` (the canonical safe replacement)', () => {
    const result = runRule(preferTagOverRole, `const B = () => <div role="button" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('suggests <ul> (not <menu>) for `<div role="list">`', () => {
    const result = runRule(preferTagOverRole, `const L = () => <div role="list" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<ul>`");
    expect(result.diagnostics[0].message).not.toContain("`<menu>`");
  });

  it("does not suggest table tags for ARIA grid composite roles on divs", () => {
    const source = `const Grid = () => (
      <div role="grid">
        <div role="rowgroup">
          <div role="row">
            <div role="columnheader">Name</div>
            <div role="rowheader">Row</div>
            <div role="gridcell">Ada</div>
            <div role="cell">1815</div>
          </div>
        </div>
      </div>
    );`;
    const result = runRule(preferTagOverRole, source);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <input> for a valued custom `<div role="slider">` (multi-thumb / resize handle)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Thumb = () => <span role="slider" tabIndex={-1} aria-valuemin={0} aria-valuemax={100} aria-valuenow={50} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <input> for a drag-to-resize `<span role="spinbutton">`', () => {
    const result = runRule(
      preferTagOverRole,
      `const Resizer = () => <span role="spinbutton" aria-valuemin={0} aria-valuenow={width} onPointerDown={handlePointerDown} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still suggests <input> for a bare `<div role="slider">`', () => {
    const result = runRule(preferTagOverRole, `const S = () => <div role="slider" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does not suggest <hr> for a draggable splitter `<div role="separator">` (mouse/touch handlers)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Splitter = () => <div role="separator" onMouseDown={handleSplitterMouseDown} onTouchStart={handleSplitterMouseDown} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <hr> for a `<div role="separator">` with visible children (hr is void)', () => {
    const result = runRule(
      preferTagOverRole,
      `const GroupTitle = ({ title }) => <div role="separator">{title}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <progress> for a `<div role="progressbar">` with custom children', () => {
    const result = runRule(
      preferTagOverRole,
      `const Bar = () => <div role="progressbar"><div className="line" /><div className="line" /></div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still suggests <progress> for a bare `<div role="progressbar">`', () => {
    const result = runRule(preferTagOverRole, `const Bar = () => <div role="progressbar" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does not suggest <input> for a contentEditable `<div role="textbox">` (rich token editor)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Editor = () => <div role="textbox" aria-multiline="true" contentEditable="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not report an `aria-hidden` `<div role="separator">` (excluded from the tree)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Deco = () => <div role="separator" aria-hidden="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <button> for a `<div role="button">` wrapping an input (nested interactive)', () => {
    const result = runRule(
      preferTagOverRole,
      `const DropZone = () => <div role="button" tabIndex={0}><input type="file" /></div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <button> for a `<div role="button">` with block children', () => {
    const result = runRule(
      preferTagOverRole,
      `const Icon = () => <div role="button" tabIndex={0}><p>Label</p></div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <button> for a `<span role="button">` nested inside a native <button>', () => {
    const result = runRule(
      preferTagOverRole,
      `const Row = () => <button type="button"><span>Title</span><span role="button" onClick={openSettings}>Settings</span></button>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still suggests <button> for a `<div role="button">` with plain text content', () => {
    const result = runRule(
      preferTagOverRole,
      `const B = () => <div role="button" tabIndex={0}>Click me</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('suggests <button> for an href-less `<a role="button">` (hand-rolled button)', () => {
    const result = runRule(
      preferTagOverRole,
      `const A = () => <a role="button" tabIndex={0} onKeyDown={handleKeyDown}>Toggle</a>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<button>`");
  });

  it('does not report `<a role="button" href="...">` (a real link styled as a button)', () => {
    const result = runRule(
      preferTagOverRole,
      `const A = () => <a role="button" href="/docs">Docs</a>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not report `<a role="button" {...props}>` (spread could supply href)', () => {
    const result = runRule(
      preferTagOverRole,
      `const A = (props) => <a role="button" {...props}>Maybe link</a>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not report other roles on an anchor (`<a role="tab">`)', () => {
    const result = runRule(preferTagOverRole, `const A = () => <a role="tab">Tab</a>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report role usage in testlike files (mock scaffolding)", () => {
    const result = runRule(preferTagOverRole, `const Mock = () => <div role="button">Open</div>;`, {
      filename: "src/components/trash/TrashGrid.test.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <hr> for a window-splitter `<div role="separator">` (focusable/valued)', () => {
    const result = runRule(
      preferTagOverRole,
      `const S = () => <div role="separator" tabIndex={0} aria-valuenow={50} aria-valuemin={0} aria-valuemax={100} aria-orientation="vertical" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still suggests <hr> for a decorative `<div role="separator">`', () => {
    const result = runRule(preferTagOverRole, `const S = () => <div role="separator" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<hr>`");
  });
});
