import { describe, expect, it } from "vite-plus/test";
import { applyUpdateHunks, parseApplyPatch } from "../src/stats/parse-apply-patch.js";

describe("parseApplyPatch", () => {
  it("parses Add, Update, and Delete ops from one envelope", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: a.ts",
      "+export const a = 1;",
      "*** Update File: b.ts",
      "@@",
      " keep",
      "-old",
      "+new",
      "*** Delete File: c.ts",
      "*** End Patch",
    ].join("\n");
    const ops = parseApplyPatch(patch);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({ type: "add", path: "a.ts", addedLines: ["export const a = 1;"] });
    expect(ops[1].type).toBe("update");
    expect(ops[1].path).toBe("b.ts");
    expect(ops[2]).toEqual({ type: "delete", path: "c.ts" });
  });

  it("captures a Move to directive on an update", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: old.ts",
      "*** Move to: new.ts",
      "@@",
      "+x",
      "*** End Patch",
    ].join("\n");
    const ops = parseApplyPatch(patch);
    expect(ops[0].movePath).toBe("new.ts");
  });

  it("returns nothing for a patch with no file headers", () => {
    expect(parseApplyPatch("not a patch")).toEqual([]);
  });
});

describe("applyUpdateHunks", () => {
  it("applies context / add / remove against a base via line search", () => {
    const base = "line one\nline two\nline three\n";
    const result = applyUpdateHunks(base, [
      "@@",
      " line one",
      "-line two",
      "+line 2",
      " line three",
    ]);
    expect(result).toBe("line one\nline 2\nline three\n");
  });

  it("returns null when a context line is not found in the base", () => {
    expect(applyUpdateHunks("a\nb\n", ["@@", " missing", "+x"])).toBeNull();
  });
});
