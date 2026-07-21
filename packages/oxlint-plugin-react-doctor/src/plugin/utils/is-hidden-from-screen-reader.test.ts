import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";

const getOpeningElements = (code: string): ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">> => {
  const parsed = parseFixture(code);
  const openingElements: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (isNodeOfType(value, "JSXOpeningElement")) openingElements.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "parent") visit(child);
    }
  };
  visit(parsed.program);
  return openingElements;
};

describe("isHiddenFromScreenReader", () => {
  it("recognizes statically active hidden attributes", () => {
    const openingElements = getOpeningElements(
      `const Example = () => <><span hidden /><span hidden="false" /><span hidden={true} /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps false and unresolved hidden attributes visible", () => {
    const openingElements = getOpeningElements(
      `const Example = ({ hidden }) => <><span hidden={false} /><span hidden={null} /><span hidden={hidden} /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("uses ARIA true-false token semantics", () => {
    const openingElements = getOpeningElements(
      `const Example = () => <><span aria-hidden /><span aria-hidden="TRUE" /><span aria-hidden={true} /><span aria-hidden="false" /><span aria-hidden={1} /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("recognizes brace-wrapped and static-template hidden values", () => {
    const openingElements = getOpeningElements(
      "const Example = () => <><input type={'hidden'} /><input type={`hidden`} /><span aria-hidden={`true`} /></>;",
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("honors authoritative attributes and unresolved later spreads", () => {
    const openingElements = getOpeningElements(
      `const Example = ({ props }) => <><span aria-hidden {...props} /><span {...props} aria-hidden={false} /><span hidden {...props} /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("resolves hidden values from static object spreads", () => {
    const openingElements = getOpeningElements(
      `const Example = () => <><span {...{ "aria-hidden": true }} /><input {...{ type: "hidden" }} /><span hidden={false} {...{ hidden: true }} /><span {...{ hidden: false }} hidden /><span {...{ "aria-hidden": false }} aria-hidden /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("resolves nested static spreads and keeps dynamic overrides unknown", () => {
    const openingElements = getOpeningElements(
      `const Example = ({ props }) => <><span {...{ ...{ "aria-hidden": true } }} /><input {...{ ...{ type: "hidden" } }} /><span aria-hidden {...{ "aria-hidden": false }} /><span aria-hidden {...{ ...props }} /></>;`,
    );
    expect(openingElements.map((element) => isHiddenFromScreenReader(element, undefined))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
