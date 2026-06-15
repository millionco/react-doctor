import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEffectCallback } from "./no-async-effect-callback.js";

describe("no-async-effect-callback", () => {
  it("flags an async arrow effect callback", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `
      const Profile = ({ id }) => {
        useEffect(async () => {
          const user = await load(id);
          setUser(user);
        }, [id]);
        return null;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("returns a Promise");
  });

  it("flags an async function-expression effect callback", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `
      function App() {
        useEffect(async function () {
          await sync();
        });
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `useLayoutEffect` with an async callback", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `const C = () => { useLayoutEffect(async () => { await measure(); }, []); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `React.useEffect(async ...)` via the namespace", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `const C = () => { React.useEffect(async () => { await x(); }, []); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a sync callback that calls an inner async function", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `
      const Profile = ({ id }) => {
        useEffect(() => {
          const run = async () => {
            const user = await load(id);
            setUser(user);
          };
          run();
        }, [id]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain sync effect callback", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `const C = () => { useEffect(() => { document.title = "x"; }, []); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an async callback passed to a non-effect hook", () => {
    const result = runRule(
      noAsyncEffectCallback,
      `const C = () => { useMemo(async () => await compute(), []); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an async callback passed to an ordinary function", () => {
    const result = runRule(noAsyncEffectCallback, `subscribe(async () => { await handle(); });`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
