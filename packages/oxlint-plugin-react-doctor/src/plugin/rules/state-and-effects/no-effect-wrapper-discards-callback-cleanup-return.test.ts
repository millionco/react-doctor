import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectWrapperDiscardsCallbackCleanupReturn } from "./no-effect-wrapper-discards-callback-cleanup-return.js";

describe("no-effect-wrapper-discards-callback-cleanup-return", () => {
  it("flags a bare fn() when the param is typed EffectCallback", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (fn: EffectCallback, deps?: DependencyList) => {
        const isMount = useRef(true);
        useEffect(() => {
          if (isMount.current) {
            isMount.current = false;
          } else {
            fn();
          }
        }, deps);
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare effect() when the wrapper is typed typeof useEffect", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect: typeof useEffect = (effect, deps) => {
        const mounted = useRef(false);
        useLayoutEffect(() => {
          if (!mounted.current) {
            mounted.current = true;
            return;
          }
          effect();
        }, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare call when the param returns void or a cleanup", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: () => void | (() => void), deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          if (mounted.current) {
            effect();
          } else {
            mounted.current = true;
          }
        }, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the param is typed () => void", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useEffectAsync = (effect: () => void, deps?: DependencyList) => {
        useEffect(() => {
          effect();
        }, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the forwarded call is already returned", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          if (mounted.current) return effect();
          mounted.current = true;
        }, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a bare call that is not a forwarded EffectCallback", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useMount = (cb) => {
        useEffect(() => {
          scrollTo(0, 0);
        }, []);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the callback is forwarded directly to useEffect", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback, deps?: DependencyList) => {
        useEffect(effect, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the param has no resolvable type annotation", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (fn, deps) => {
        useEffect(() => {
          fn();
        }, deps);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet outside a custom hook", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `function setup(fn: EffectCallback, deps) {
        useEffect(() => {
          fn();
        }, deps);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
