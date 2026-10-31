import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const walkAstCounter = vi.hoisted(() => vi.fn());
const stateHookCounter = vi.hoisted(() => vi.fn());

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return { ...originalModule, walkAst: walkAstCounter.mockImplementation(originalModule.walkAst) };
});

vi.mock("./utils/is-readonly-named-react-state-hook.js", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("./utils/is-readonly-named-react-state-hook.js")>();
  return {
    ...originalModule,
    isReadonlyNamedReactStateHook: stateHookCounter.mockImplementation(
      originalModule.isReadonlyNamedReactStateHook,
    ),
  };
});

describe("local literal state admission work", () => {
  it("checks the program once across independent state initializers", () => {
    walkAstCounter.mockClear();
    const result = runRule(
      noDirectStateMutation,
      `import {useState} from "react"; export const Panel=()=>{${Array.from({ length: 20 }, (_, index) => `const initial${index}={count:0};const[value${index},setValue${index}]=useState(initial${index});value${index}.count=1;`).join("")}return <output/>;};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(20);
    expect(walkAstCounter.mock.calls.filter(([node]) => node.type === "Program")).toHaveLength(1);
  });

  it.each([false, true])("checks one shared initializer once when escaped=%s", (isEscaped) => {
    walkAstCounter.mockClear();
    stateHookCounter.mockClear();
    const result = runRule(
      noDirectStateMutation,
      `import {useState} from "react"; export const Panel=()=>{const initial={count:0};${Array.from({ length: 20 }, (_, index) => `const[value${index},setValue${index}]=useState(initial);value${index}.count=1;`).join("")}${isEscaped ? "consume(initial);" : ""}return <output/>;};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(isEscaped ? 0 : 20);
    expect(stateHookCounter).toHaveBeenCalledTimes(20);
    expect(walkAstCounter.mock.calls.filter(([node]) => node.type === "Program")).toHaveLength(1);
  });
});
