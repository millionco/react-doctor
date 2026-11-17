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

describe("immutable exported value indexes", () => {
  it("preserves local aliases, forward default bindings and last variable declarations", () => {
    const parsed = parseFixture(
      "export default local;export {local as renamed};var local=1;var local=2;",
    );
    const direct = findExportedValue(parsed.program, "default");
    expect(isNodeOfType(direct, "Literal") && direct.value).toBe(2);
    expect(findExportedValue(parsed.program, "renamed")).toBe(direct);
    expect(findExportedValue(parsed.program, "missing")).toBeNull();
  });

  it("preserves type-only exclusions and direct default exports", () => {
    const parsed = parseFixture(
      'import {type Shape,value} from "fixture";const alias=3;export {value};export type {Shape};export default 4;',
    );
    expect(findExportedValue(parsed.program, "Shape")).toBeNull();
    const value = findExportedValue(parsed.program, "value");
    expect(isNodeOfType(value, "Identifier") && value.name).toBe("value");
    const direct = findExportedValue(parsed.program, "default");
    expect(isNodeOfType(direct, "Literal") && direct.value).toBe(4);
  });

  it("retains unsupported re-exports and supports direct function and class defaults", () => {
    const reexport = parseFixture('export {value} from "fixture";export type Other=string;');
    expect(findExportedValue(reexport.program, "value")).toBeNull();
    expect(findExportedValue(reexport.program, "Other")).toBeNull();
    const named = parseFixture("export function value(){};");
    expect(isNodeOfType(findExportedValue(named.program, "value"), "FunctionDeclaration")).toBe(
      true,
    );
    const defaultClass = parseFixture("export default class Value{}");
    expect(
      isNodeOfType(findExportedValue(defaultClass.program, "default"), "ClassDeclaration"),
    ).toBe(true);
  });

  it("keeps separate Program identities independent", () => {
    const first = parseFixture("export const value=1;");
    const second = parseFixture("export const value=2;");
    const firstValue = findExportedValue(first.program, "value");
    const secondValue = findExportedValue(second.program, "value");
    expect(isNodeOfType(firstValue, "Literal") && firstValue.value).toBe(1);
    expect(isNodeOfType(secondValue, "Literal") && secondValue.value).toBe(2);
    expect(findExportedValue(first.program, "value")).toBe(firstValue);
  });

  for (const exportCount of [20, 100]) {
    it(`indexes ${exportCount} exports once for successful and missing lookups`, () => {
      const parsed = parseFixture(
        Array.from(
          { length: exportCount },
          (_, index) => `export const value${index}=${index};`,
        ).join(""),
      );
      if (parsed.program.type !== "Program") throw new Error("Missing synthetic Program");
      const body = parsed.program.body;
      let statementVisits = 0;
      Object.defineProperty(parsed.program, "body", {
        get: () =>
          new Proxy(body, {
            get: (target, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property)) statementVisits += 1;
              return Reflect.get(target, property, receiver);
            },
          }),
      });
      for (let index = 0; index < exportCount; index += 1) {
        const value = findExportedValue(parsed.program, `value${index}`);
        expect(isNodeOfType(value, "Literal") && value.value).toBe(index);
        expect(findExportedValue(parsed.program, `missing${index}`)).toBeNull();
      }
      expect(statementVisits).toBe(exportCount);
    });
  }
});
