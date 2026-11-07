import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readGeneratedEsmFactoryFile } from "./read-generated-esm-factory-file.js";
import { readGeneratedEsmFactoryImport } from "./read-generated-esm-factory-import.js";

const IMPORT = `import { makeBadge as make } from '../runtime/factory.mjs';`;
const WRAPPER = `export function BlueBadge(input) { return make({"color":"blue"})(input); };`;

const generatedModule = (body: string): string => `${IMPORT}\n${body}`;

describe("readGeneratedEsmFactoryImport", () => {
  it("invalidates a cached generated module when its file identity changes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "generated-esm-factory-"));
    const target = path.join(directory, "generated.mjs");
    const replacement = path.join(directory, "replacement.mjs");
    const timestamp = new Date("2000-01-01T00:00:00.000Z");
    const source = generatedModule(WRAPPER);
    const size = Buffer.byteLength(source);
    try {
      fs.writeFileSync(target, source);
      fs.utimesSync(target, timestamp, timestamp);
      const before = readGeneratedEsmFactoryFile(target, size);
      expect(before?.factory.exportedName).toBe("makeBadge");
      expect(readGeneratedEsmFactoryFile(target, size)).toBe(before);

      fs.writeFileSync(replacement, source.replace("return make", "return deny"));
      fs.utimesSync(replacement, timestamp, timestamp);
      fs.renameSync(replacement, target);
      expect(readGeneratedEsmFactoryFile(target, size)).toBeNull();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads one aliased import and pure generated wrappers", () => {
    const source = String.raw`
      // Synthetic generator output.
      import { createBadge as build } from "@demo/runtime"
      export function SandBadge(props) {
        return build({"label":"a\"b", "parts":[{"x":-1.25e+2}, null, false]})(props);
      };
      ;
      export function SunBadge(input) { return build({"label":"\u2600"})(input) }
    `;
    expect(readGeneratedEsmFactoryImport(source)).toEqual({
      source: "@demo/runtime",
      exportedName: "createBadge",
    });
  });

  it("reads a direct named import and a string containing delimiter text", () => {
    const source = `
      import { make } from "./generator.mjs";
      export function Swatch(props) { return make({"label":"}); export /*"})(props); };
    `;
    expect(readGeneratedEsmFactoryImport(source)).toEqual({
      source: "./generator.mjs",
      exportedName: "make",
    });
  });

  it.each([
    ["another call before the return", WRAPPER.replace("return make", "track(); return make")],
    ["an unrelated factory", WRAPPER.replace("return make", "return anotherFactory")],
    ["a different forwarded parameter", WRAPPER.replace(")(input)", ")(external)")],
    ["an import-shadowing parameter", WRAPPER.replace("(input)", "(make)")],
    ["an import-shadowing declaration", WRAPPER.replace("BlueBadge", "make")],
    ["duplicate wrappers", `${WRAPPER}\n${WRAPPER}`],
    ["a thenable namespace export", WRAPPER.replace("BlueBadge", "then")],
    ["an escaped thenable namespace export", WRAPPER.replace("BlueBadge", String.raw`th\u0065n`)],
    ["a reserved declaration name", WRAPPER.replace("BlueBadge", "await")],
    ["an async wrapper", WRAPPER.replace("export function", "export async function")],
    ["an ASI return", WRAPPER.replace("return make", "return\nmake")],
    [
      "a return followed by a multiline comment",
      WRAPPER.replace("return make", "return /*\n*/ make"),
    ],
    ["other top-level code", `${WRAPPER}\nexport const sideEffect = mutate();`],
    ["an unterminated trailing comment", `${WRAPPER}\n/*`],
    ["no wrappers", ";"],
  ])("refuses %s", (_name, body) => {
    expect(readGeneratedEsmFactoryImport(generatedModule(body))).toBeNull();
  });

  it.each([
    ["a second binding", IMPORT.replace("makeBadge as make", "makeBadge as make, another")],
    ["an escaped module specifier", String.raw`import { make } from '\u002e/runtime.mjs';`],
    ["a side-effect import", `${IMPORT}\nimport './side-effects.mjs';`],
  ])("refuses %s in the import", (_name, declaration) => {
    expect(readGeneratedEsmFactoryImport(`${declaration}\n${WRAPPER}`)).toBeNull();
  });

  it.each([
    ["an array argument", '["blue"]'],
    ["a trailing comma", '{"color":"blue",}'],
    ["a leading-zero number", '{"color":02}'],
    ["a partial exponent", '{"color":1e}'],
    ["a JavaScript-only escape", String.raw`{"color":"\x20"}`],
    ["a call in object data", '{"color":readColor()}'],
    ["an inline comment in object data", '{"color":/* comment */"blue"}'],
    ["an escaped prototype setter", String.raw`{"\u005f_proto__":{}}`],
  ])("refuses %s in a wrapper argument", (_name, argument) => {
    const body = WRAPPER.replace('{"color":"blue"}', () => argument);
    expect(readGeneratedEsmFactoryImport(generatedModule(body))).toBeNull();
  });

  it("bounds nested object data before recursing further", () => {
    const data = `{"parts":${"[".repeat(80)}null${"]".repeat(80)}}`;
    expect(
      readGeneratedEsmFactoryImport(
        generatedModule(WRAPPER.replace('{"color":"blue"}', () => data)),
      ),
    ).toBeNull();
  });
});
