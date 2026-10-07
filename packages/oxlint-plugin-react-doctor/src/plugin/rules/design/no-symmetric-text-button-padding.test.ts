import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSymmetricTextButtonPadding } from "./no-symmetric-text-button-padding.js";

describe("no-symmetric-text-button-padding", () => {
  it("flags a static text button with one padding utility", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Save = () => <button className="rounded-md bg-blue-600 p-3">Save changes</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts distinct horizontal and vertical padding", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Save = () => <button className="rounded-md px-4 py-2">Save changes</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an explicit axis override", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Save = () => <button className="p-3 px-5">Save changes</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores icon-only and dynamic-label buttons", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Toolbar = ({ label }) => <><button className="p-3"><Search /></button><button className="p-3">{label}</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("screen-reader-only button names", () => {
  it("allows square padding on icons with hidden accessible names", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Actions = () => <>
      <button className="p-2"><span className="sr-only">Filter</span><FilterIcon /></button>
      <button className="p-2"><span><span className="sr-only">Search</span><SearchIcon /></span></button>
    </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
  it("still checks visible text and labels revealed at a breakpoint", () => {
    const result = runRule(
      noSymmetricTextButtonPadding,
      `const Actions = () => <>
      <button className="p-2"><span className="sr-only">Filter</span>Apply</button>
      <button className="p-2"><span className="sr-only sm:not-sr-only">Search</span><SearchIcon /></button>
      <button className="p-2"><span className="sm:sr-only">Open</span><OpenIcon /></button>
    </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });
});
