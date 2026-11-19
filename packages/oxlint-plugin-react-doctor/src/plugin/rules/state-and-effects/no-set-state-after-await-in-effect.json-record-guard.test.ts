import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const source = `
import { useEffect, useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function Status({ url }: { url: string }) {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    async function update() {
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!cancelled && isRecord(data) && isRecord(data.task)) {
        setValue(data.task);
      }
    }
    void update();
    return () => { cancelled = true; };
  }, [url]);
  return <output>{String(value)}</output>;
}
`;

const check = (program: string) => {
  const result = runRule(noSetStateAfterAwaitInEffect, program);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("no-set-state-after-await-in-effect native JSON guards", () => {
  it("respects cancellation before closed record checks", () => {
    expect(check(source)).toEqual([]);
  });

  it("allows unrelated numeric member reads", () => {
    expect(check(source + "\nconst first = [0][0];")).toEqual([]);
  });

  it.each([
    ["a missing cancellation check", source.replace("!cancelled && ", "")],
    ["a foreign fetch provider", source.replace("await fetch(url)", "await loadResponse(url)")],
    [
      "an escaped JSON object",
      source.replace("      if (!cancelled", "      expose(data);\n      if (!cancelled"),
    ],
    [
      "a replaced response method",
      source.replace("      const data", "      response.json = getOtherData;\n      const data"),
    ],
    ["an unchecked fallback", source.replace("() => ({})", "() => loadFallback()")],
    [
      "an extra predicate call",
      source.replace("return Boolean(value)", "notify(); return Boolean(value)"),
    ],
    [
      "a prototype getter through Reflect",
      source +
        '\nconst shared = Reflect.get({}, "__proto__");\nReflect.defineProperty(shared, "task", { get: notify });',
    ],
    [
      "a destructured prototype",
      source +
        '\nconst { prototype: shared } = Object;\nObject.defineProperty(shared, "task", { get: notify });',
    ],
    [
      "a global alias",
      source +
        '\nconst { Object: Obj } = globalThis;\nconst { prototype: shared } = Obj;\nObj.defineProperty(shared, "task", { get: notify });',
    ],
    ["an overridden intrinsic predicate", source + "\nArray.isArray = notAList;"],
    [
      "a later suspension",
      source.replace(
        "        setValue(data.task)",
        "        await loadMore();\n        setValue(data.task)",
      ),
    ],
  ])("retains the warning for %s", (_name, program) => {
    expect(check(program)).toHaveLength(1);
  });
});
