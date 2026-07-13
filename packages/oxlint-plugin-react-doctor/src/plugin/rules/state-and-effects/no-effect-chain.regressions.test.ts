import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectChain } from "./no-effect-chain.js";

describe("no-effect-chain — regressions", () => {
  it("stays silent when an effect callback is received as a custom-hook parameter", () => {
    const result = runRule(
      noEffectChain,
      `const useForwardedEffect = (effect) => {
  const [value, setValue] = useState(0);
  useEffect(effect, []);
  setValue(value + 1);
  return value;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["$", "($)", "void ($)", "(0, $)"])(
    "flags a cross-effect chain through discarded wrapper %s",
    (wrapper) => {
      const upstreamEffect = wrapper.replaceAll("$", "useEffect(() => { setFirst(1); }, [])");
      const downstreamEffect = wrapper.replaceAll(
        "$",
        "useEffect(() => { setSecond(first + 1); }, [first])",
      );
      const result = runRule(
        noEffectChain,
        `function C() {
          const [first, setFirst] = useState(0);
          const [second, setSecond] = useState(0);
          ${upstreamEffect};
          ${downstreamEffect};
          return second;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still flags the canonical cross-effect state chain", () => {
    const result = runRule(
      noEffectChain,
      `function Game({ card }) {
        const [goldCardCount, setGoldCardCount] = useState(0);
        const [round, setRound] = useState(1);
        useEffect(() => { if (card.gold) setGoldCardCount(goldCardCount + 1); }, [card]);
        useEffect(() => { if (goldCardCount > 3) setRound(round + 1); }, [goldCardCount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Docs-validation r2 docMismatch (Security.jsx): the downstream effect
  // only persists state to localStorage — synchronizing with an external
  // system, which the doc excludes; no re-render chain exists.
  it("stays silent when the downstream effect persists to localStorage", () => {
    const result = runRule(
      noEffectChain,
      `function Security() {
        const [selectedVideo, setSelectedVideo] = useState('');
        const [selectedAudio, setSelectedAudio] = useState('');
        useEffect(() => {
          const saved = JSON.parse(raw);
          if (saved.videoDeviceId) setSelectedVideo(saved.videoDeviceId);
          if (saved.audioDeviceId) setSelectedAudio(saved.audioDeviceId);
        }, []);
        useEffect(() => {
          if (selectedVideo || selectedAudio) {
            localStorage.setItem('media', JSON.stringify({ selectedVideo, selectedAudio }));
          }
        }, [selectedVideo, selectedAudio]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats window.sessionStorage access as external sync too", () => {
    const result = runRule(
      noEffectChain,
      `function C() {
        const [value, setValue] = useState('');
        useEffect(() => { setValue(compute()); }, []);
        useEffect(() => { window.sessionStorage.setItem('key', value); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation r2 (tracecat data-table): the downstream effect calls
  // the setter returned by useLocalStorage — the same browser-storage
  // persistence, one hook removed.
  it("stays silent when the downstream effect calls a useLocalStorage setter", () => {
    const result = runRule(
      noEffectChain,
      `function DataTable({ clearSelectionTrigger }) {
        const [tableState, setTableState] = useLocalStorage('table-state', {});
        const [rowSelection, setRowSelection] = useState({});
        const [sorting, setSorting] = useState([]);
        useEffect(() => { setRowSelection({}); }, [clearSelectionTrigger]);
        useEffect(() => {
          setTableState({ ...tableState, sorting, rowSelection });
        }, [sorting, rowSelection]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a chain whose downstream effect writes plain state", () => {
    const result = runRule(
      noEffectChain,
      `function C() {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        useEffect(() => { setFirst(1); }, []);
        useEffect(() => { setSecond(first + 1); }, [first]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a state chain through exact effect callback bindings", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        const writeFirst = () => { setFirst(1); };
        const writeSecond = () => { setSecond(first + 1); };
        const downstreamEffect = writeSecond;
        useEffect(writeFirst, []);
        useEffect(downstreamEffect, [first]);
        return second;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a state chain through function declaration callbacks", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        function writeFirst() { setFirst(1); }
        function writeSecond() { setSecond(first + 1); }
        useEffect(writeFirst, []);
        useEffect(writeSecond, [first]);
        return second;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a function declaration that synchronizes external storage", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [value, setValue] = useState('');
        function loadValue() { setValue(compute()); }
        function persistValue() { localStorage.setItem('value', value); }
        useEffect(loadValue, []);
        useEffect(persistValue, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a function declaration that calls a storage-hook setter", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [storedValue, setStoredValue] = useLocalStorage('value', 0);
        function loadSource() { setSource(compute()); }
        function persistSource() { setStoredValue(source); }
        useEffect(loadSource, []);
        useEffect(persistSource, [source]);
        return storedValue;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a declared callback only defers its state write", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() { setTimeout(() => setSource(1), 0); }
        function updateTarget() { setTarget(source + 1); }
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a state chain through an exact alias to a declared callback", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() { setSource(1); }
        function updateTarget() { setTarget(source + 1); }
        const aliasedUpdate = updateTarget;
        useEffect(loadSource, []);
        useEffect(aliasedUpdate, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when a declared callback is reassigned", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() { setSource(1); }
        function updateTarget() { setTarget(source + 1); }
        updateTarget = () => consume(source);
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unused nested external-sync helpers", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() { setSource(1); }
        function updateTarget() {
          function unusedPersistence() { localStorage.setItem('target', String(target)); }
          setTarget(source + 1);
        }
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a declared callback invokes a nested external-sync helper", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        function loadSource() { setSource(1); }
        function synchronizeStorage() {
          function persistSource() { localStorage.setItem('source', String(source)); }
          persistSource();
        }
        useEffect(loadSource, []);
        useEffect(synchronizeStorage, [source]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a chain whose declared callback invokes a nested state writer", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() {
          function writeSource() { setSource(1); }
          writeSource();
        }
        function updateTarget() { setTarget(source + 1); }
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores state writes deferred inside an invoked async function", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() {
          void (async () => {
            await loadSourceValue();
            setSource(1);
          })();
        }
        function updateTarget() { setTarget(source + 1); }
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["inline arrow", "useEffect(async () => { await loadSourceValue(); setSource(1); }, []);"],
    [
      "named arrow",
      "const loadSource = async () => { await loadSourceValue(); setSource(1); }; useEffect(loadSource, []);",
    ],
    [
      "function declaration",
      "async function loadSource() { await loadSourceValue(); setSource(1); } useEffect(loadSource, []);",
    ],
    [
      "function expression",
      "const loadSource = async function () { await loadSourceValue(); setSource(1); }; useEffect(loadSource, []);",
    ],
    [
      "exact alias",
      "const loadSource = async () => { await loadSourceValue(); setSource(1); }; const effectCallback = loadSource; useEffect(effectCallback, []);",
    ],
    [
      "layout effect",
      "const loadSource = async () => { await loadSourceValue(); setSource(1); }; useLayoutEffect(loadSource, []);",
    ],
  ])("ignores state writes in an async %s effect callback", (_callbackShape, upstreamEffect) => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        ${upstreamEffect}
        useEffect(() => { setTarget(source + 1); }, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an async effect callback whose state writes straddle await", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        async function loadSource() {
          setSource(1);
          await loadSourceValue();
          setSource(2);
        }
        useEffect(loadSource, []);
        useEffect(() => { setTarget(source + 1); }, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "inline arrow",
      "useEffect(async () => { setTarget(await loadTargetValue(source)); }, [source]);",
    ],
    [
      "named declaration",
      "async function synchronizeTarget() { setTarget(await loadTargetValue(source)); } useEffect(synchronizeTarget, [source]);",
    ],
    [
      "exact alias",
      "const synchronizeTarget = async () => { setTarget(await loadTargetValue(source)); }; const effectCallback = synchronizeTarget; useEffect(effectCallback, [source]);",
    ],
    [
      "layout effect",
      "const synchronizeTarget = async () => { setTarget(await loadTargetValue(source)); }; useLayoutEffect(synchronizeTarget, [source]);",
    ],
  ])(
    "ignores an async %s effect callback as the downstream chain link",
    (_callbackShape, downstreamEffect) => {
      const result = runRule(
        noEffectChain,
        `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        useEffect(() => { setSource(1); }, []);
        ${downstreamEffect}
        return target;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("flags the synchronous near-neighbor through an exact callback alias", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        const loadSource = () => { setSource(1); };
        const effectCallback = loadSource;
        useEffect(effectCallback, []);
        useEffect(() => { setTarget(source + 1); }, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags state writes inside an invoked synchronous function", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        function loadSource() { (() => setSource(1))(); }
        function updateTarget() { setTarget(source + 1); }
        useEffect(loadSource, []);
        useEffect(updateTarget, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a declared opaque context setter", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ setAutoPlaying }) {
        const [playing, setPlaying] = useState(false);
        function stopPlaying() { setPlaying(false); }
        function synchronizeContext() { return setAutoPlaying(playing); }
        useEffect(stopPlaying, []);
        useEffect(synchronizeContext, [playing, setAutoPlaying]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a state chain when the upstream effect explicitly returns a local setter call", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const [target, setTarget] = useState(0);
        useEffect(() => { return setSource(1); }, []);
        useEffect(() => { setTarget(source + 1); }, [source]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the downstream effect synchronizes an opaque context setter", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ disabled, setAutoPlaying }) {
        const [playing, setPlaying] = useState(false);
        useEffect(() => { if (disabled) setPlaying(false); }, [disabled]);
        useEffect(() => setAutoPlaying(playing), [playing, setAutoPlaying]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a block-bodied opaque context setter", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ disabled, setAutoPlaying }) {
        const [playing, setPlaying] = useState(false);
        useEffect(() => { if (disabled) setPlaying(false); }, [disabled]);
        useEffect(() => { setAutoPlaying(playing); }, [playing, setAutoPlaying]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a block-bodied setter proven to come from local state", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ disabled }) {
        const [playing, setPlaying] = useState(false);
        const [autoPlaying, setAutoPlaying] = useState(false);
        useEffect(() => { if (disabled) setPlaying(false); }, [disabled]);
        useEffect(() => { setAutoPlaying(playing); }, [playing]);
        return autoPlaying;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chain when the upstream effect also calls an opaque prop setter", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ setLoading }) {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        useEffect(() => { setFirst(1); setLoading(false); }, []);
        useEffect(() => { setSecond(first + 1); }, [first]);
        return second;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the downstream effect returns a helper-owned subscription", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [ready, setReady] = useState(false);
        useEffect(() => { setReady(true); }, []);
        useEffect(() => { doWork(ready); return createSubscription(ready); }, [ready]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the upstream effect returns a helper-owned subscription", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [ready, setReady] = useState(false);
        const [status, setStatus] = useState('');
        useEffect(() => { setReady(true); return createSubscription(); }, []);
        useEffect(() => { setStatus(ready ? 'on' : 'off'); }, [ready]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["setAlias", "applyFirst"])(
    "flags a chain through a local state-writing wrapper named %s",
    (wrapperName) => {
      const result = runRule(
        noEffectChain,
        `function Widget() {
          const [ready, setReady] = useState(false);
          const [first, setFirst] = useState(0);
          const ${wrapperName} = () => { setFirst(1); };
          useEffect(() => { setReady(true); }, []);
          useEffect(() => { ${wrapperName}(); }, [ready]);
          return first;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("flags a state chain whose downstream effect calls a concise helper", () => {
    const result = runRule(
      noEffectChain,
      `function Widget() {
        const [source, setSource] = useState(0);
        const syncDownstream = (value) => consume(value);
        useEffect(() => { setSource(1); }, []);
        useEffect(() => syncDownstream(source), [source]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
