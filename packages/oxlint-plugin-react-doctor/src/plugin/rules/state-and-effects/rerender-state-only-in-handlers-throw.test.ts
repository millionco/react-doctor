import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("state consumed by render throws", () => {
  it.each([
    "if (pending) throw task;",
    "if (task) throw new Error('Failed');",
    "const result = task; if (pending) throw result;",
    "switch (status) { case 'pending': throw task; }",
  ])("preserves state used by %s", (renderStatement) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      const Screen = ({ pending, status }) => {
        const [task, setTask] = useState(null);
        ${renderStatement}
        return <button onClick={() => setTask(load())}>Load</button>;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["const fail = () => { throw task; };", "const fail = () => { throw task; }; fail();"])(
    "does not follow handler-local throws: %s",
    (handlerBody) => {
      const result = runRule(
        rerenderStateOnlyInHandlers,
        `
      const Screen = () => {
        const [task, setTask] = useState(null);
        const onClick = () => { setTask(load()); ${handlerBody} };
        return <button onClick={onClick}>Load</button>;
      };
    `,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not use a shadowed throw binding", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      const Screen = ({ pending }) => {
        const [task, setTask] = useState(null);
        if (pending) { const task = new Error('Failed'); throw task; }
        return <button onClick={() => setTask(load())}>Load</button>;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
