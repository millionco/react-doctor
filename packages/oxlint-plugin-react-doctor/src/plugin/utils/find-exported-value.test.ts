import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { findExportedValue } from "./find-exported-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("findExportedValue", () => {
  it("resolves a default export backed by an imported binding", () => {
    const parsed = parseFixture(`import dayjs from"dayjs";export default dayjs`);
    const exportedValue = findExportedValue(parsed.program, "default");
    expect(isNodeOfType(exportedValue, "Identifier") && exportedValue.name).toBe("dayjs");
  });

  it("does not resolve a type-only imported binding", () => {
    const parsed = parseFixture(`import type Dayjs from"dayjs";export default Dayjs`);
    expect(findExportedValue(parsed.program, "default")).toBeNull();
  });
});

describe("own class value exports", () => {
  it.each([
    ["direct named", "export class Resource {}", "Resource"],
    ["local named", "class Resource {};export {Resource};", "Resource"],
    ["local renamed", "class Resource {};export {Resource as Owned};", "Owned"],
    ["direct default", "export default class Resource {}", "default"],
    ["local default", "class Resource {};export default Resource;", "default"],
  ])("resolves %s", (_description, source, exportedName) => {
    const parsed = parseFixture(source, { filename: "owner.ts" });
    expect(parsed.errors).toEqual([]);
    expect(isNodeOfType(findExportedValue(parsed.program, exportedName), "ClassDeclaration")).toBe(
      true,
    );
  });
  it("does not use a type-only class export", () => {
    const parsed = parseFixture("class Resource {};export type {Resource};", {
      filename: "owner.ts",
    });
    expect(findExportedValue(parsed.program, "Resource")).toBeNull();
  });
});
