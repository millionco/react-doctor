import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";
import { noInitializeState } from "./no-initialize-state.js";

const expectDerivedStateDiagnostics = (code: string, diagnosticCount: number): void => {
  const result = runRule(noDerivedState, code, { forceJsx: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("derived-state effect-write contract", () => {
  it("reports direct aliases and branch-local copies from props or state", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value, enabled }) {
        const [source] = useState("fallback");
        const [first, setFirst] = useState("");
        const [second, setSecond] = useState("");
        useEffect(() => {
          const nextValue = value;
          if (enabled) setFirst(nextValue);
          else setSecond(source);
        }, [enabled, source, value]);
        return <>{first}{second}</>;
      }`,
      2,
    );
  });

  it("stays silent when a copied identifier is reassigned before the state write", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        useEffect(() => {
          let nextValue = value;
          nextValue = localStorage.getItem("value");
          setMirror(nextValue);
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      0,
    );
  });

  it("reports a proven copy when the effect also has unrelated cleanup", () => {
    expectDerivedStateDiagnostics(
      `function Example({ source, value }) {
        const [mirror, setMirror] = useState("");
        useEffect(() => {
          setMirror(value);
          const subscription = source.subscribe();
          return () => subscription.remove();
        }, [source, value]);
        return <div>{mirror}</div>;
      }`,
      1,
    );
  });

  it("reports copies transformed by pure global namespaces", () => {
    expectDerivedStateDiagnostics(
      `function Example({ count, raw }) {
        const [serialized, setSerialized] = useState("");
        const [rounded, setRounded] = useState(0);
        useEffect(() => {
          setSerialized(JSON.stringify(count));
          setRounded(Math.floor(raw));
        }, [count, raw]);
        return <>{serialized}{rounded}</>;
      }`,
      2,
    );
  });

  it("reports copies through narrow standard member transforms", () => {
    expectDerivedStateDiagnostics(
      `function Example({ items, value }) {
        const [normalized, setNormalized] = useState("");
        const [visible, setVisible] = useState([]);
        useEffect(() => {
          const localItems = items;
          const localValue = value;
          const nextValue = localValue.trim().toLowerCase();
          setNormalized(nextValue);
          setVisible(localItems.filter((item) => item).concat(localItems));
        }, [items, value]);
        return <>{normalized}{visible.length}</>;
      }`,
      2,
    );
  });

  it("stays silent for opaque prop, DOM, storage, and network-like member calls", () => {
    expectDerivedStateDiagnostics(
      `function Example({ api, source, url }) {
        const [propResult, setPropResult] = useState(null);
        const [attribute, setAttribute] = useState(null);
        const [stored, setStored] = useState(null);
        const [networkResult, setNetworkResult] = useState(null);
        useEffect(() => {
          setPropResult(source.readExternalValue());
          setAttribute(document.body.getAttribute("data-value"));
          setStored(localStorage.getItem("value"));
          setNetworkResult(api.request(url));
        }, [api, source, url]);
        return <>{propResult}{attribute}{stored}{networkResult}</>;
      }`,
      0,
    );
  });

  it("follows one direct helper frame with parameter substitution", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        const commit = (nextValue) => setMirror(nextValue);
        useEffect(() => {
          commit(value);
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      1,
    );
  });

  it("keeps substitutions separate for repeated helper invocations", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        const commit = (nextValue) => setMirror(nextValue);
        useEffect(() => {
          commit("constant");
          commit(value);
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      1,
    );
  });

  it("follows useCallback, React useEffectEvent, and a structural local useEvent", () => {
    expectDerivedStateDiagnostics(
      `import React, { useCallback, useEffectEvent } from "react";
      const useEvent = (callback) => {
        const callbackRef = useRef(callback);
        callbackRef.current = callback;
        return useCallback((...args) => callbackRef.current(...args), []);
      };
      function Example({ firstValue, secondValue, thirdValue }) {
        const [first, setFirst] = useState("");
        const [second, setSecond] = useState("");
        const [third, setThird] = useState("");
        const firstCommit = useCallback(() => setFirst(firstValue), [firstValue]);
        const secondCommit = useEffectEvent(() => setSecond(secondValue));
        const thirdCommit = useEvent(() => setThird(thirdValue));
        useEffect(() => {
          firstCommit();
          secondCommit();
          thirdCommit();
        }, [firstCommit, secondCommit, thirdCommit]);
        return <>{first}{second}{third}</>;
      }`,
      3,
    );
  });

  it("stays silent when a local useEvent does not forward its callback", () => {
    expectDerivedStateDiagnostics(
      `import { useCallback, useRef } from "react";
      const useEvent = (callback) => {
        useRef(callback);
        return useCallback(() => {}, []);
      };
      function Example({ value }) {
        const [mirror, setMirror] = useState("");
        const commit = useEvent(() => setMirror(value));
        useEffect(() => {
          commit();
        }, [commit]);
        return <div>{mirror}</div>;
      }`,
      0,
    );
  });

  it("follows synchronous IIFEs and iterator callbacks", () => {
    expectDerivedStateDiagnostics(
      `function Example({ values }) {
        const [first, setFirst] = useState("");
        const [last, setLast] = useState("");
        useEffect(() => {
          ((nextValue) => setFirst(nextValue))(values[0]);
          values.forEach((nextValue) => setLast(nextValue));
        }, [values]);
        return <>{first}{last}</>;
      }`,
      2,
    );
  });

  it("stays silent for deferred copies and values introduced by promises", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value, request }) {
        const [mirror, setMirror] = useState("");
        const [result, setResult] = useState(null);
        useEffect(() => {
          setTimeout(() => setMirror(value), 500);
          request().then((response) => setResult(response));
        }, [request, value]);
        return <>{mirror}{result}</>;
      }`,
      0,
    );
  });

  it("stays bounded across async helpers, recursive helpers, and a second call frame", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        const asyncCommit = async () => setMirror(value);
        const recursiveCommit = () => {
          setMirror(value);
          recursiveCommit();
        };
        const innerCommit = () => setMirror(value);
        const outerCommit = () => innerCommit();
        useEffect(() => {
          asyncCommit();
          recursiveCommit();
          outerCommit();
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      0,
    );
  });

  it("resolves one stable callable ref and rejects a reassigned ref", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [stable, setStable] = useState("");
        const [mutable, setMutable] = useState("");
        const stableRef = useRef(() => setStable(value));
        const mutableRef = useRef(() => setMutable(value));
        mutableRef.current = () => setMutable("other");
        useEffect(() => {
          stableRef.current();
          mutableRef.current();
        }, [value]);
        return <>{stable}{mutable}</>;
      }`,
      1,
    );
  });

  it("uses binding identity for shadowed helper parameters", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        const commit = (value) => setMirror(value);
        useEffect(() => {
          commit("local");
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      0,
    );
  });

  it("stays silent for storage, DOM, query results, and unknown value helpers", () => {
    expectDerivedStateDiagnostics(
      `import { deriveValue } from "./derive-value";
      function Example({ queryKey }) {
        const query = useQuery({ queryKey });
        const elementRef = useRef(null);
        const [stored, setStored] = useState("");
        const [width, setWidth] = useState(0);
        const [data, setData] = useState(null);
        const [unknown, setUnknown] = useState(null);
        useEffect(() => {
          setStored(localStorage.getItem("value"));
          setWidth(elementRef.current.offsetWidth);
          setData(query.data);
          setUnknown(deriveValue(queryKey));
        }, [query.data, queryKey]);
        return <div ref={elementRef}>{stored}{width}{data}{unknown}</div>;
      }`,
      0,
    );
  });

  it("stays silent for independent drafts, object smuggling, and request acknowledgements", () => {
    expectDerivedStateDiagnostics(
      `function Example({ value }) {
        const [draft, setDraft] = useState("");
        const [smuggled, setSmuggled] = useState("");
        const [request, setRequest] = useState(null);
        const [acknowledgement, setAcknowledgement] = useState(null);
        const payload = { value };
        useEffect(() => {
          setDraft(value);
          setSmuggled(payload.value);
          if (request) {
            setAcknowledgement(request);
            setRequest(null);
          }
        }, [request, value]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      0,
    );
  });

  it("does not merge source resets from mutually exclusive branches", () => {
    expectDerivedStateDiagnostics(
      `function Example({ enabled }) {
        const [source, setSource] = useState("fallback");
        const [mirror, setMirror] = useState("");
        useEffect(() => {
          if (enabled) setMirror(source);
          else setSource("fallback");
        }, [enabled, source]);
        return <div>{mirror}</div>;
      }`,
      1,
    );
  });

  it("does not trust shadowed pure global names", () => {
    expectDerivedStateDiagnostics(
      `function Example({ Math, JSON, parseInt, value }) {
        const [rounded, setRounded] = useState(0);
        const [serialized, setSerialized] = useState("");
        const [parsed, setParsed] = useState(0);
        useEffect(() => {
          setRounded(Math.floor(value));
          setSerialized(JSON.stringify(value));
          setParsed(parseInt(value));
        }, [JSON, Math, parseInt, value]);
        return <>{rounded}{serialized}{parsed}</>;
      }`,
      0,
    );
  });
});

describe("derived-state family contracts", () => {
  const code = `function Example({ value }) {
    const [mirror, setMirror] = useState(null);
    useEffect(() => {
      setMirror(value);
    }, []);
    return <div>{mirror}</div>;
  }`;

  it("shares proven render-source writes with no-derived-state-effect", () => {
    const result = runRule(noDerivedStateEffect, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a renamed React import",
      `import { useEffect as runEffect, useState } from "react";
      const Example = ({ value }) => {
        const [mirror, setMirror] = useState("");
        runEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
    [
      "an immutable local alias",
      `import { useEffect, useState } from "react";
      const runEffect = useEffect;
      const Example = ({ value }) => {
        const [mirror, setMirror] = useState("");
        runEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
    [
      "a multi-hop immutable alias",
      `import { useEffect, useState } from "react";
      const localEffect = useEffect;
      const runEffect = localEffect;
      const Example = ({ value }) => {
        const [mirror, setMirror] = useState("");
        runEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
  ])("recognizes %s by React binding identity", (_name, aliasCode) => {
    for (const rule of [noDerivedState, noDerivedStateEffect, noAdjustStateOnPropChange]) {
      const result = runRule(rule, aliasCode);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    [
      "a userland same-name function",
      `const useEffect = (callback) => callback();
      const Example = ({ value }) => {
        const [mirror, setMirror] = useState("");
        useEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
    [
      "a shadowed React import",
      `import { useEffect, useState } from "react";
      const Example = ({ value }) => {
        const useEffect = (callback) => callback();
        const [mirror, setMirror] = useState("");
        useEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
    [
      "a mutable alias",
      `import { useEffect, useState } from "react";
      let runEffect = useEffect;
      runEffect = (callback) => callback();
      const Example = ({ value }) => {
        const [mirror, setMirror] = useState("");
        runEffect(() => setMirror(value), [value]);
        return mirror;
      };`,
    ],
  ])("rejects %s", (_name, aliasCode) => {
    for (const rule of [noDerivedState, noDerivedStateEffect, noAdjustStateOnPropChange]) {
      const result = runRule(rule, aliasCode);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("shares proven render-source writes with no-initialize-state", () => {
    const result = runRule(noInitializeState, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("matches state initializers by binding identity", () => {
    const result = runRule(
      noInitializeState,
      `function Example({ config, nextConfig }) {
        const [value, setValue] = useState(config.value);
        useEffect(() => {
          const config = nextConfig;
          setValue(config.value);
        }, []);
        return <div>{value}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for DOM measurements stored after layout", () => {
    const measurementCode = `const useDelay = (callback) => {
      const callbackRef = useRef(callback);
      callbackRef.current = callback;
      return useCallback((...args) => callbackRef.current(...args), []);
    };
    function Masonry({ items, columnCount, getItemRef }) {
      const [itemHeights, setItemHeights] = useState([]);
      const collectItemSize = useDelay(() => {
        const nextItemHeights = items.map((item) => {
          const itemElement = getItemRef(item.key);
          const rectangle = itemElement?.getBoundingClientRect();
          return [item.key, rectangle ? rectangle.height : 0];
        });
        setItemHeights((previousItemHeights) =>
          isEqual(previousItemHeights, nextItemHeights) ? previousItemHeights : nextItemHeights
        );
      });
      useLayoutEffect(() => {
        collectItemSize();
      }, [items, columnCount, collectItemSize]);
      return itemHeights.length;
    }`;
    for (const rule of [
      noDerivedState,
      noDerivedStateEffect,
      noAdjustStateOnPropChange,
      noInitializeState,
    ]) {
      const result = runRule(rule, measurementCode, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("reports a render-known copy stored from useLayoutEffect", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Example({ value }) {
        const [mirror, setMirror] = useState("");
        useLayoutEffect(() => {
          setMirror(value.trim());
        }, [value]);
        return <div>{mirror}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["React as any", "React!"])(
    "preserves state identity through a %s namespace receiver",
    (reactReceiver) => {
      const result = runRule(
        noDerivedStateEffect,
        `import * as React from "react";
        const runEffect = React.useEffect;
        const Example = ({ value }) => {
          const [mirror, setMirror] = (${reactReceiver}).useState("");
          runEffect(() => setMirror(value), [value]);
          return mirror;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    ["structuredClone", "structuredClone(value)"],
    ["Object.assign", "Object.assign({}, value)"],
    ["Array.from", "Array.from(value)"],
    ["Date construction", "new Date(value)"],
    ["Set construction", "new Set(value)"],
    ["slice", "value.slice()"],
    ["replace", 'value.replace("a", "b")'],
    ["reduce", "value.reduce((total, item) => total + item, 0)"],
    ["flatMap", "value.flatMap((item) => [item])"],
    ["toSorted", "value.toSorted()"],
    ["encodeURIComponent", "encodeURIComponent(value)"],
  ])("preserves render ownership through %s", (_name, expression) => {
    const transformCode = `function Example({ value }) {
      const [mirror, setMirror] = useState(null);
      useEffect(() => {
        setMirror(${expression});
      }, [value]);
      return <div>{String(mirror)}</div>;
    }`;
    for (const rule of [noDerivedState, noDerivedStateEffect, noAdjustStateOnPropChange]) {
      const result = runRule(rule, transformCode, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not trust shadowed deterministic global transforms", () => {
    const transformCode = `function Example({ Array, Date, Object, Set, encodeURIComponent, structuredClone, value }) {
      const [first, setFirst] = useState(null);
      const [second, setSecond] = useState(null);
      const [third, setThird] = useState(null);
      const [fourth, setFourth] = useState(null);
      const [fifth, setFifth] = useState(null);
      const [sixth, setSixth] = useState(null);
      useEffect(() => {
        setFirst(structuredClone(value));
        setSecond(Object.assign({}, value));
        setThird(Array.from(value));
        setFourth(new Date(value));
        setFifth(new Set(value));
        setSixth(encodeURIComponent(value));
      }, [Array, Date, Object, Set, encodeURIComponent, structuredClone, value]);
      return <>{first}{second}{third}{fourth}{fifth}{sixth}</>;
    }`;
    for (const rule of [noDerivedState, noDerivedStateEffect, noAdjustStateOnPropChange]) {
      const result = runRule(rule, transformCode, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays silent for a debounced copy of render state", () => {
    const debouncedCode = `function useDebouncedState(value, delay) {
      const [state, setState] = useState(value);
      const [debouncedState, setDebouncedState] = useState(value);
      useEffect(() => {
        const timeout = setTimeout(() => {
          setDebouncedState(state);
        }, delay);
        return () => clearTimeout(timeout);
      }, [delay, state]);
      return [state, debouncedState, setState];
    }`;
    for (const rule of [noDerivedState, noAdjustStateOnPropChange]) {
      const result = runRule(rule, debouncedCode);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("requires a copied render source for prop-change adjustment", () => {
    const copiedResult = runRule(
      noAdjustStateOnPropChange,
      `function Example({ value }) {
        const [mirror, setMirror] = useState(null);
        useEffect(() => setMirror(value), [value]);
        return mirror;
      }`,
    );
    const constantResult = runRule(
      noAdjustStateOnPropChange,
      `function Example({ value }) {
        const [mirror, setMirror] = useState(null);
        useEffect(() => setMirror(null), [value]);
        return mirror;
      }`,
    );
    expect(copiedResult.parseErrors).toEqual([]);
    expect(copiedResult.diagnostics).toHaveLength(1);
    expect(constantResult.parseErrors).toEqual([]);
    expect(constantResult.diagnostics).toEqual([]);
  });
});
