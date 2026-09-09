import { parseJSON5 } from "confbox";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { readJson5File } from "../src/utils/read-json5-file.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-json5-"));
const configPath = path.join(temporaryDirectory, "doctor.config.json");

afterAll(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("readJson5File", () => {
  it.each([
    '{"rules":{"react-doctor/no-danger":"off"}}',
    '{"rules":{"react-doctor/no-danger":"error","react-doctor/no-danger":"off"}}',
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{}}}',
    '{"zero":-0,"large":1e400,"small":1e-400}',
    '{"text":"\\ud800","unicode":"界😀"}',
    ' \r\n {"lint":false} \t',
    '\ufeff{"lint":false}',
    '{ /* config */ rules: {"react-doctor/no-danger": "off",}, }',
    "{ rules: { 'react-doctor/no-danger': 'off' } }",
    '{"number":NaN,"infinite":Infinity,"hex":0xff}',
    "null",
    "[true, false, null]",
  ])("preserves JSON5 values for %s", (sourceText) => {
    fs.writeFileSync(configPath, sourceText);

    const parsed = readJson5File(configPath);
    const expected = parseJSON5(sourceText);
    assert.deepStrictEqual(parsed, expected);
    if (parsed !== null && typeof parsed === "object") {
      expect(Object.getPrototypeOf(parsed)).toBe(Object.getPrototypeOf(expected));
      assert.deepStrictEqual(
        Object.getOwnPropertyDescriptors(parsed),
        Object.getOwnPropertyDescriptors(expected),
      );
    }
  });

  it.each(["", "{ rules: ", '{"lint":true} trailing', '{"text":"\\xzz"}'])(
    "preserves JSON5 syntax errors for %s",
    (sourceText) => {
      fs.writeFileSync(configPath, sourceText);

      let expectedError: unknown;
      try {
        parseJSON5(sourceText);
      } catch (error) {
        expectedError = error;
      }
      expect(expectedError).toBeInstanceOf(SyntaxError);
      expect(() => readJson5File(configPath)).toThrow(expectedError);
    },
  );

  it("preserves missing-file errors", () => {
    expect(() => readJson5File(path.join(temporaryDirectory, "missing.json"))).toThrow(/ENOENT/);
  });

  it.each(["\u2028", "\u2029"])(
    "preserves JSON5 warnings for literal separator %s",
    (separator) => {
      const sourceText = `{"text":"before${separator}after${separator}"}`;
      fs.writeFileSync(configPath, sourceText);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const expected = parseJSON5(sourceText);
        const expectedWarnings = [...warn.mock.calls];
        expect(expectedWarnings).toHaveLength(2);
        warn.mockClear();

        assert.deepStrictEqual(readJson5File(configPath), expected);
        expect(warn.mock.calls).toEqual(expectedWarnings);
      } finally {
        warn.mockRestore();
      }
    },
  );
});
