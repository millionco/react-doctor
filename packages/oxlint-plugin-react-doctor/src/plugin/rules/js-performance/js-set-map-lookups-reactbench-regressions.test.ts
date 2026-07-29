import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

const runLookupRule = (source: string) => runRule(jsSetMapLookups, source);

const expectNoDiagnostics = (source: string): void => {
  const result = runLookupRule(source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
};

const expectDiagnostic = (source: string): void => {
  const result = runLookupRule(source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

describe("js-set-map-lookups — ReactBench regressions", () => {
  it("stays silent for a transpiled rest helper whose call sites omit only small fixed lists", () => {
    expectNoDiagnostics(`
      var __rest = (this && this.__rest) || function (source, excluded) {
        var target = {};
        for (var property in source) {
          if (Object.prototype.hasOwnProperty.call(source, property) && excluded.indexOf(property) < 0) {
            target[property] = source[property];
          }
        }
        return target;
      };
      const first = __rest(props, ["children", "className"]);
      const second = __rest(options, ["disabled"]);
    `);
  });

  it("reports a transpiled rest helper when any omission list is larger than the cutoff", () => {
    expectDiagnostic(`
      var __rest = (this && this.__rest) || function (source, excluded) {
        var target = {};
        for (var property in source) {
          if (Object.prototype.hasOwnProperty.call(source, property) && excluded.indexOf(property) < 0) {
            target[property] = source[property];
          }
        }
        return target;
      };
      const rest = __rest(props, ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    `);
  });

  it("stays silent for an empty transpiled rest omission list", () => {
    expectNoDiagnostics(`
      var __rest = (this && this.__rest) || function (source, excluded) {
        var target = {};
        for (var property in source) {
          if (Object.prototype.hasOwnProperty.call(source, property) && excluded.indexOf(property) < 0) {
            target[property] = source[property];
          }
        }
        return target;
      };
      const rest = __rest(props, []);
    `);
  });

  it("reports a transpiled rest helper with an unproven omission list", () => {
    expectDiagnostic(`
      var __rest = (this && this.__rest) || function (source, excluded) {
        var target = {};
        for (var property in source) {
          if (Object.prototype.hasOwnProperty.call(source, property) && excluded.indexOf(property) < 0) {
            target[property] = source[property];
          }
        }
        return target;
      };
      const rest = __rest(props, excludedKeys);
    `);
  });

  it("stays silent when an array transform rebuilds the receiver in every iteration", () => {
    expectNoDiagnostics(`
      const selectedValues: string[] = [];
      const rows: Array<{ value: string }> = [];
      const matchingRows = rows.filter((row) =>
        selectedValues.filter(Boolean).includes(row.value)
      );
    `);
  });

  it("stays silent through transparent wrappers on proven fresh arrays", () => {
    expectNoDiagnostics(`
      const selectedValues: string[] = [];
      const rows: Array<{ value: string }> = [];
      const matchingRows = rows.filter((row) =>
        (selectedValues as string[]).filter(Boolean).includes(row.value)
      );
    `);
  });

  it("reports an unproven userland transform method that can return a cached large array", () => {
    expectDiagnostic(`
      const cachedValues = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
      const cache = { filter: () => cachedValues };
      const matchingRows = rows.filter((row) => cache.filter().includes(row.value));
    `);
  });

  it("stays silent for proven string receivers that previously looked like arrays", () => {
    expectNoDiagnostics(`
      const matchingRows = rows.filter((row) =>
        text.slice(row.offset).includes(row.query) ||
        (row.title || "").includes(row.query)
      );
    `);
  });

  it("stays silent through transparent wrappers on proven strings", () => {
    expectNoDiagnostics(`
      const rows: Array<{ offset: number; query: string }> = [];
      const text: string | null = "content";
      const matchingRows = rows.filter((row) =>
        text!.slice(row.offset).includes(row.query)
      );
    `);
  });

  it.each([
    "buildRowSearchText(row)",
    "hastClassName(row)",
    "parseFilterTokens(row)",
    "sectionTitle",
  ])("reports an unproven receiver named like a string or fresh array: %s", (receiver) => {
    expectDiagnostic(`
      const matchingRows = rows.filter((row) => ${receiver}.includes(row.value));
    `);
  });

  it.each(["conflicts", "categories", "excludeKeys"])(
    "reports an unproven stable array named %s",
    (arrayName) => {
      expectDiagnostic(`
        function findMatches(rows: string[], ${arrayName}: string[]) {
          return rows.filter((row) => ${arrayName}.includes(row));
        }
      `);
    },
  );

  it("reports a stable large array reused across repeated lookups", () => {
    expectDiagnostic(`
      const allowedValues = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
      const matchingRows = rows.filter((row) => allowedValues.includes(row.value));
    `);
  });
});
