import { describe, expect, it, vi } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { createProgramGatedVisitors } from "./create-program-gated-visitors.js";

const programNode = parseFixture("").program;

describe("createProgramGatedVisitors", () => {
  it("registers active selectors before traversal while suppressing an ineligible file", () => {
    const identifierVisitor = vi.fn();
    const visitors = createProgramGatedVisitors({
      createVisitors: () => ({ Identifier: identifierVisitor }),
      shouldAnalyzeProgram: () => false,
    });

    expect(Object.keys(visitors)).toEqual(["Identifier", "Program"]);
    visitors.Program?.(programNode);
    visitors.Identifier?.({ type: "Identifier", name: "value" });
    expect(identifierVisitor).not.toHaveBeenCalled();
  });

  it("forwards active visitors after the program gate passes", () => {
    const programVisitor = vi.fn();
    const identifierVisitor = vi.fn();
    const visitors = createProgramGatedVisitors({
      createVisitors: () => ({ Program: programVisitor, Identifier: identifierVisitor }),
      shouldAnalyzeProgram: () => true,
    });

    visitors.Program?.(programNode);
    visitors.Identifier?.({ type: "Identifier", name: "value" });
    expect(programVisitor).toHaveBeenCalledOnce();
    expect(identifierVisitor).toHaveBeenCalledOnce();
  });
});
