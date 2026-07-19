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
      };`,
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
      };`,
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
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare optional call effect?.() on an optional EffectCallback param", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect?: EffectCallback, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          if (mounted.current) {
            effect?.();
          } else {
            mounted.current = true;
          }
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded bare call mounted.current && effect()", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          mounted.current && effect();
          mounted.current = true;
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare call inside a statement-position ternary", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          mounted.current ? effect() : (mounted.current = true);
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare call when the EffectCallback param has a default value", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback = () => {}, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          if (mounted.current) {
            effect();
          } else {
            mounted.current = true;
          }
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a defaulted param typed plain () => void", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useEffectOnce = (effect: () => void = () => {}, deps?: DependencyList) => {
        useEffect(() => {
          effect();
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the optional call is already returned", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect?: EffectCallback, deps?: DependencyList) => {
        const mounted = useRef(false);
        useEffect(() => {
          if (mounted.current) return effect?.();
          mounted.current = true;
        }, deps);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the param is typed () => void", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useEffectAsync = (effect: () => void, deps?: DependencyList) => {
        useEffect(() => {
          effect();
        }, deps);
      };`,
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
      };`,
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
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the callback is forwarded directly to useEffect", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useUpdateEffect = (effect: EffectCallback, deps?: DependencyList) => {
        useEffect(effect, deps);
      };`,
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
      };`,
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
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: for-of loop variable shadows the forwarded param while the real forwarded call is properly returned", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useQueuedEffects = (effect: EffectCallback, deps: DependencyList) => {
  const queuedEffects = useRef<Array<() => void>>([]);
  useEffect(() => {
    for (const effect of queuedEffects.current) {
      effect();
    }
    queuedEffects.current = [];
    return effect();
  }, deps);
  return queuedEffects;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: React 19 cleanup-style ref callback: bare detach call refCallback(null) whose return value is meaningless by contract", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useAttachedRef = (
  refCallback: (node: HTMLElement | null) => void | (() => void),
  nodeRef: RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) {
      refCallback(null);
      return undefined;
    }
    const detach = refCallback(node);
    return () => {
      if (typeof detach === "function") {
        detach();
      } else {
        refCallback(null);
      }
    };
  }, [refCallback, nodeRef]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a bare forwarded call with a non-null argument", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback, deps: DependencyList) => {
         useEffect(() => {
           effect();
         }, deps);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags forwarded cleanup calls discarded by return void and non-final return sequences", () => {
    const voidResult = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback, deps: DependencyList) => {
         useEffect(() => { return void effect(); }, deps);
       };`,
    );
    const sequenceResult = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback, deps: DependencyList) => {
         useEffect(() => { return (effect(), undefined); }, deps);
       };`,
    );
    const returnedResult = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback, deps: DependencyList) => {
         useEffect(() => { return (prepare(), effect()); }, deps);
       };`,
    );
    expect(voidResult.diagnostics).toHaveLength(1);
    expect(sequenceResult.diagnostics).toHaveLength(1);
    expect(returnedResult.diagnostics).toHaveLength(0);
  });

  it("does not trust a local type alias named EffectCallback", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `import { useEffect } from "react";
       type EffectCallback = () => number;
       export const useValue = (effect: EffectCallback) => {
         useEffect(() => { effect(); }, [effect]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves aliased React EffectCallback type imports", () => {
    const result = runRule(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `import { useEffect, type EffectCallback as ReactEffectCallback } from "react";
       export const useValue = (effect: ReactEffectCallback) => {
         useEffect(() => { effect(); }, [effect]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
