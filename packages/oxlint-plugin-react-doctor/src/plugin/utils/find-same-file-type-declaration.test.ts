import { describe, expect, it } from "vite-plus/test";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

const parseProgram = (sourceText: string) => {
  const program = parseSourceText({ filename: "/tmp/types.ts", sourceText });
  if (!isNodeOfType(program, "Program")) throw new Error("Expected a program");
  return program;
};

describe("findSameFileTypeDeclarations", () => {
  it("keeps source order for merged interfaces", () => {
    const program = parseProgram("interface Props { name: string } interface Props { id: string }");

    expect(findSameFileTypeDeclarations(program, "Props")).toEqual([
      program.body[0],
      program.body[1],
    ]);
  });

  it("skips type declarations without an identifier", () => {
    const program = parseProgram("interface Broken {} interface Props { name: string }");
    Reflect.set(program.body[0], "id", null);

    expect(findSameFileTypeDeclarations(program, "Props")).toEqual([program.body[1]]);
  });
});
