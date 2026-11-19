import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

const source = `
import { useCallback, useEffect, useRef } from "react";

const stages = { entering: 1 };
const useStageWriter = () => {
  const stage = useRef(0);
  const write = useCallback((next: number) => {
    stage.current = next;
  }, [stage]);
  return [stage, write];
};
const useStart = ({ setStage }: { setStage: (value: number) => void }) => {
  useEffect(() => { setStage(stages.entering); }, [setStage]);
};
export function Panel() {
  const [, setStage] = useStageWriter();
  useStart({ setStage });
  return null;
}
`;

describe("no-pass-live-state-to-parent private ref writers", () => {
  it("accepts a local hook that receives an isolated ref writer", () => {
    const result = runRule(noPassLiveStateToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "more callback work",
      source.replace("stage.current = next;", "stage.current = next; notify(next);"),
    ],
    [
      "an exposed ref",
      source.replace(
        "const [, setStage] = useStageWriter();",
        "const [stage, setStage] = useStageWriter(); expose(stage);",
      ),
    ],
    [
      "an unknown spread",
      source.replace("useStart({ setStage });", "useStart({ setStage, ...forwarded });"),
    ],
    ["an exported hook", source + "\nexport { useStart };"],
    [
      "another direct caller",
      source + "\nexport const useElsewhere = (setStage) => useStart({ setStage });",
    ],
    ["a borrowed ref", source.replace("const stage = useRef(0);", "const stage = sharedRef;")],
    [
      "a shadowed callback wrapper",
      source.replace(
        "const write = useCallback",
        "const useCallback = customWrapper; const write = useCallback",
      ),
    ],
    [
      "a property redefinition",
      source.replace(
        "return [stage, write];",
        'Object.defineProperty(stage, "current", { set: notify }); return [stage, write];',
      ),
    ],
    [
      "a returned ref captured by rest",
      source
        .replace("return [stage, write];", "return [stage, write, stage];")
        .replace(
          "const [, setStage] = useStageWriter();",
          "const [, setStage, ...tail] = useStageWriter(); expose(tail[0]);",
        ),
    ],
    [
      "direct eval",
      source.replace(
        "return [stage, write];",
        'const effect = eval("observe(stage)"); return [stage, write];',
      ),
    ],
    ["a replaced iterator", source + "\nArray.prototype[Symbol.iterator] = customIterator;"],
  ])("retains the warning for %s", (_name, code) => {
    const result = runRule(noPassLiveStateToParent, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
