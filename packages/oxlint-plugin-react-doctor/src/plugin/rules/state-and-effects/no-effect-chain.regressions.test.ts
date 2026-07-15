import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectChain } from "./no-effect-chain.js";

describe("no-effect-chain — regressions", () => {
  it("stays silent when a clear-only effect cannot satisfy the downstream truthy guard", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => {
          if (!isOpen) setError(null);
        }, [isOpen]);
        useEffect(() => {
          if (error) setAnnouncement(error.message);
        }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["undefined", "undefined", "if (error) setAnnouncement(error.message)"],
    ["false", "false", "if (error) setAnnouncement('failed')"],
    ["zero", "0", "if (error) setAnnouncement('failed')"],
    ["empty string", "''", "if (error) setAnnouncement('failed')"],
    ["a conjunction", "null", "error && isOpen && setAnnouncement(error.message)"],
    ["an optional property", "null", "if (error?.message) setAnnouncement(error.message)"],
    ["a non-null comparison", "null", "if (error !== null) setAnnouncement(error.message)"],
    ["a loose non-null comparison", "null", "if (error != null) setAnnouncement(error.message)"],
    ["an early return", "null", "if (!error) return; setAnnouncement(error.message)"],
    [
      "an equality early return",
      "null",
      "if (error === null) return; setAnnouncement(error.message)",
    ],
  ])("stays silent for a clear-only %s write behind a contradictory guard", (_, value, work) => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(${value}); }, [isOpen]);
        useEffect(() => { ${work}; }, [error, isOpen]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent through exact const aliases and transparent wrappers", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        const clearedError = null;
        useEffect(() => { if (!isOpen) setError(clearedError as null); }, [isOpen]);
        useEffect(() => {
          const currentError = error;
          if (currentError) setAnnouncement(currentError.message);
        }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a destructuring default unknown when the source can supply a truthy value", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen, payload }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        const { nextError = null } = payload;
        useEffect(() => { if (!isOpen) setError(nextError); }, [isOpen, nextError]);
        useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a functional setter that always clears the state", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(() => null); }, [isOpen]);
        useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["() => { return; }", "() => {}"])(
    "stays silent for an undefined-returning updater %s",
    (updater) => {
      const result = runRule(
        noEffectChain,
        `function ErrorDialog({ isOpen }) {
          const [error, setError] = useState(null);
          const [announcement, setAnnouncement] = useState('ready');
          useEffect(() => { if (!isOpen) setError(${updater}); }, [isOpen]);
          useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
          return announcement;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["async () => null", "function* () { return null; }"])(
    "still flags for an object-returning updater %s",
    (updater) => {
      const result = runRule(
        noEffectChain,
        `function ErrorDialog({ isOpen }) {
          const [error, setError] = useState(null);
          const [announcement, setAnnouncement] = useState('ready');
          useEffect(() => { if (!isOpen) setError(${updater}); }, [isOpen]);
          useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
          return announcement;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("stays silent after a nested branch that always returns for the clear-only value", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen, preferEarlyReturn }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => {
          if (!error) {
            if (preferEarlyReturn) return;
            else return;
          }
          setAnnouncement(error.message);
        }, [error, preferEarlyReturn]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when every call site in one writer effect clears the state", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen, didReset }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => {
          if (!isOpen) setError(null);
          if (didReset) setError(() => null);
        }, [isOpen, didReset]);
        useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let a handler-only truthy writer contaminate the clear-only effect edge", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
        return <button onClick={() => setError(new Error('failed'))}>{announcement}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the contradictory work lives in an invoked local helper", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        const announceError = () => { if (error) setAnnouncement(error.message); };
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { announceError(); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["the cleared branch performs work", "setError(null)", "if (!error) setAnnouncement('clear')"],
    [
      "one writer can establish a truthy value",
      "setError(null); setError(new Error('failed'))",
      "if (error) setAnnouncement(error.message)",
    ],
    [
      "the setter value is opaque",
      "setError(loadError())",
      "if (error) setAnnouncement(error.message)",
    ],
    [
      "the functional setter result is state-dependent",
      "setError((previous) => previous ?? new Error('failed'))",
      "if (error) setAnnouncement(error.message)",
    ],
    [
      "unrelated downstream work remains reachable",
      "setError(null)",
      "recordAttempt(); if (error) setAnnouncement(error.message)",
    ],
  ])("still flags when %s", (_, writer, reader) => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) { ${writer}; } }, [isOpen]);
        useEffect(() => { ${reader}; }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a property assignment", "if (enabled) document.title = 'ready'"],
    ["an update", "if (enabled) window.renderCount++"],
    ["a constructor", "if (enabled) new RenderSession()"],
    ["a deletion", "if (enabled) delete window.pendingRender"],
    ["a throw", "if (enabled) throw new Error('failed')"],
  ])("still flags when downstream work is %s", (_, work) => {
    const result = runRule(
      noEffectChain,
      `function StatusPanel({ active }) {
        const [enabled, setEnabled] = useState(false);
        useEffect(() => { if (active) setEnabled(true); }, [active]);
        useEffect(() => { ${work}; }, [enabled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a clear-only value cannot reach non-call work", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { if (error) document.title = 'failed'; }, [error]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when a shadowed downstream name makes work reachable", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        const announceError = (error) => { if (error) setAnnouncement(error.message); };
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { announceError(new Error('other')); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when another sibling effect can satisfy the reader guard", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen, didFail }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { if (didFail) setError(new Error('failed')); }, [didFail]);
        useEffect(() => { if (error) setAnnouncement(error.message); }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the reader's alternate branch performs work for the cleared value", () => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => {
          if (error) setAnnouncement(error.message);
          else setAnnouncement('clear');
        }, [error]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a null equality", "if (error === null) setAnnouncement('clear')"],
    ["a loose null equality", "if (error == null) setAnnouncement('clear')"],
    ["a negated guard", "if (!error) setAnnouncement('clear')"],
    ["a disjunction", "if (error || isOpen) setAnnouncement('active')"],
    ["an opaque predicate", "if (shouldAnnounce(error)) setAnnouncement('active')"],
  ])("still flags a clear-only write when the reader uses %s", (_, reader) => {
    const result = runRule(
      noEffectChain,
      `function ErrorDialog({ isOpen }) {
        const [error, setError] = useState(null);
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setError(null); }, [isOpen]);
        useEffect(() => { ${reader}; }, [error, isOpen]);
        return announcement;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["closed", "closed", "open"],
    ["idle", "idle", "ready"],
  ])(
    "stays silent when a %s discriminant cannot satisfy the reader equality",
    (_, value, guard) => {
      const result = runRule(
        noEffectChain,
        `function StatusDialog({ isOpen }) {
        const [status, setStatus] = useState('ready');
        const [announcement, setAnnouncement] = useState('ready');
        useEffect(() => { if (!isOpen) setStatus('${value}'); }, [isOpen]);
        useEffect(() => { if (status === '${guard}') setAnnouncement(status); }, [status]);
        return announcement;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

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

  it.each([
    ["direct transition", "cancelScheduler(); setPlaying(false);"],
    ["stable callback transition", "pause();"],
    ["inline transition", "(() => { cancelScheduler(); setPlaying(false); })();"],
  ])("stays silent for the Slideshow timer synchronization through a %s", (_, transition) => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Slideshow({ disabled, currentIndex }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, []);
        const pause = React.useCallback(() => {
          cancelScheduler();
          setPlaying(false);
        }, [cancelScheduler]);
        React.useEffect(() => {
          if (playing && !disabled) scheduleNextSlide();
          else cancelScheduler();
        }, [currentIndex, playing, disabled, cancelScheduler]);
        React.useEffect(() => {
          if (playing && disabled) ${transition}
        }, [playing, disabled, pause]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the exact Slideshow direct transition job", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Slideshow({ disabled, currentIndex }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, []);
        React.useEffect(() => {
          if (playing && !disabled) scheduleNextSlide();
          else cancelScheduler();
        }, [currentIndex, playing, disabled, cancelScheduler]);
        React.useEffect(() => {
          if (playing && disabled) setPlaying(false);
        }, [playing, disabled]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a redundant state-copy chain hidden behind React useCallback", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const copyIntermediate = useCallback(() => setIntermediate(source), [source]);
        useEffect(() => copyIntermediate(), [copyIntermediate]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "named import",
      imports: 'import { useCallback, useEffect, useRef, useState } from "react";',
      hook: "useCallback",
      callback: "cancelScheduler",
    },
    {
      name: "renamed import through a TypeScript wrapper",
      imports:
        'import { useCallback as useStableCallback, useEffect, useRef, useState } from "react";',
      hook: "useStableCallback",
      callback: "cancelScheduler satisfies typeof cancelScheduler",
    },
    {
      name: "multi-hop const alias",
      imports: 'import { useCallback, useEffect, useRef, useState } from "react";',
      hook: "useCallback",
      callback: "secondAlias",
      aliases: "const firstAlias = cancelScheduler; const secondAlias = firstAlias;",
    },
  ])("resolves timer synchronization through a $name", ({ imports, hook, callback, aliases }) => {
    const result = runRule(
      noEffectChain,
      `${imports}
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = useState(true);
        const scheduler = useRef();
        const cancelScheduler = ${hook}(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, []);
        ${aliases ?? ""}
        useEffect(() => {
          if (!playing || disabled) (${callback})();
        }, [playing, disabled, cancelScheduler]);
        useEffect(() => {
          if (playing && disabled) setPlaying(false);
        }, [playing, disabled]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves nested stable callbacks transitively", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, []);
        const stopScheduler = React.useCallback(() => cancelScheduler(), [cancelScheduler]);
        React.useEffect(() => {
          if (!playing || disabled) stopScheduler();
        }, [playing, disabled, stopScheduler]);
        React.useEffect(() => {
          if (playing && disabled) setPlaying(false);
        }, [playing, disabled]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "userland useCallback",
      "const useCallback = (callback) => callback; const cancelScheduler = useCallback(() => { clearTimeout(scheduler.current); scheduler.current = undefined; });",
      "cancelScheduler",
    ],
    ["shadowed useCallback parameter", "", "useCallback"],
    [
      "mutable callback alias",
      "const stableCancel = React.useCallback(() => { clearTimeout(scheduler.current); scheduler.current = undefined; }, []); let cancelScheduler = stableCancel; cancelScheduler = replacement;",
      "cancelScheduler",
    ],
    [
      "async stable callback",
      "const cancelScheduler = React.useCallback(async () => { clearTimeout(scheduler.current); scheduler.current = undefined; });",
      "cancelScheduler",
    ],
    [
      "generator stable callback",
      "const cancelScheduler = React.useCallback(function* () { clearTimeout(scheduler.current); scheduler.current = undefined; }, []);",
      "cancelScheduler",
    ],
  ])("keeps unknown or deferred $name conservative", (name, declaration, callback) => {
    const callbackParameter = name === "shadowed useCallback parameter" ? ", useCallback" : "";
    const callbackDeclaration =
      declaration ||
      "const cancelScheduler = useCallback(() => { clearTimeout(scheduler.current); scheduler.current = undefined; }, []);";
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Slideshow({ disabled, replacement${callbackParameter} }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        ${callbackDeclaration}
        React.useEffect(() => {
          if (!playing || disabled) ${callback}();
        }, [playing, disabled, ${callback}]);
        React.useEffect(() => {
          if (playing && disabled) setPlaying(false);
        }, [playing, disabled]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a redundant state-copy chain through a multi-hop stable callback alias", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => setIntermediate(source), [source]);
        const firstCopy = copyIntermediate;
        const secondCopy = firstCopy;
        React.useEffect(() => secondCopy(), [secondCopy]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["implicit setter result", "() => setIntermediate(source)"],
    ["block-bodied setter", "() => { setIntermediate(source); }"],
    ["explicit setter result", "function () { return setIntermediate(source); }"],
    ["explicit undefined after a setter", "() => { setIntermediate(source); return undefined; }"],
    ["explicit null after a setter", "() => { setIntermediate(source); return null; }"],
    ["explicit false after a setter", "() => { setIntermediate(source); return false; }"],
    ["explicit number after a setter", "() => { setIntermediate(source); return 0; }"],
    ["explicit string after a setter", "() => { setIntermediate(source); return 'done'; }"],
    [
      "explicit template string after a setter",
      "() => { setIntermediate(source); return `done`; }",
    ],
    ["explicit void after a setter", "() => { setIntermediate(source); return void noop(); }"],
    ["explicit object after a setter", "() => { setIntermediate(source); return {}; }"],
    ["explicit array after a setter", "() => { setIntermediate(source); return []; }"],
    [
      "all-non-cleanup conditional after a setter",
      "() => { setIntermediate(source); return source ? undefined : null; }",
    ],
    [
      "global Boolean result after a setter",
      "() => { setIntermediate(source); return Boolean(source); }",
    ],
    [
      "global String result after a setter",
      "() => { setIntermediate(source); return String(source); }",
    ],
    ["global Symbol result after a setter", "() => { setIntermediate(source); return Symbol(); }"],
    [
      "global Promise result after a setter",
      "() => { setIntermediate(source); return Promise.resolve(source); }",
    ],
    [
      "global constructed object after a setter",
      "() => { setIntermediate(source); return new Date(); }",
    ],
    ["ignored helper result after a setter", "() => { setIntermediate(source); noop(); }"],
  ])("flags a redundant state-copy chain through an explicitly returned %s", (_, callback) => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(${callback}, [source]);
        React.useEffect(() => { return copyIntermediate(); }, [copyIntermediate]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the stable callback returns a real cleanup function", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndCopy = React.useCallback(() => {
          setIntermediate(source);
          const unsubscribe = subscribe(source);
          return () => unsubscribe();
        }, [source]);
        React.useEffect(() => { return subscribeAndCopy(); }, [subscribeAndCopy]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the stable callback returns a resolved cleanup identifier", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndCopy = React.useCallback(() => {
          setIntermediate(source);
          const unsubscribe = subscribe(source);
          const cleanup = () => unsubscribe();
          return cleanup;
        }, [source]);
        React.useEffect(() => { return subscribeAndCopy(); }, [subscribeAndCopy]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an optional stable callback call returns a cleanup function", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndCopy = React.useCallback(() => {
          setIntermediate(source);
          const unsubscribe = subscribe(source);
          return () => unsubscribe();
        }, [source]);
        React.useEffect(() => { return subscribeAndCopy?.(); }, [subscribeAndCopy]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["shadowed primitive constructor", "Boolean", "Boolean(source)"],
    ["shadowed object constructor", "Date", "new Date()"],
  ])("keeps a $name return conservative", (_, parameter, returnedValue) => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, ${parameter} }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => {
          setIntermediate(source);
          return ${returnedValue};
        }, [source, ${parameter}]);
        React.useEffect(() => { return copyIntermediate(); }, [copyIntermediate]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a conditional return with an unknown cleanup branch conservative", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, cleanup }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => {
          setIntermediate(source);
          return source ? undefined : cleanup;
        }, [source, cleanup]);
        React.useEffect(() => { return copyIntermediate(); }, [copyIntermediate]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an optional call to a stable state-copy callback", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => setIntermediate(source), [source]);
        React.useEffect(() => { return copyIntermediate?.(); }, [copyIntermediate]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nested stable state-copy callback", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => setIntermediate(source), [source]);
        const copyThroughWrapper = React.useCallback(() => copyIntermediate(), [copyIntermediate]);
        React.useEffect(() => { return copyThroughWrapper(); }, [copyThroughWrapper]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not follow a stable callback that is only passed to a deferred API", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const copyIntermediate = React.useCallback(() => setIntermediate(source), [source]);
        React.useEffect(() => queueMicrotask(copyIntermediate), [copyIntermediate]);
        React.useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves a TypeScript-wrapped React useCallback argument", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback((() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }) satisfies () => void, []);
        React.useEffect(() => {
          if (!playing || disabled) cancelScheduler();
        }, [playing, disabled, cancelScheduler]);
        React.useEffect(() => {
          if (playing && disabled) setPlaying(false);
        }, [playing, disabled]);
        return playing;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  it("stays silent when the downstream effect focuses a node mounted after expansion", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(new Map());
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId) ? <button ref={node => itemRefs.current.set(activeId, node)} /> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows transparent wrappers around a ref-backed DOM map", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(new Map());
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current!.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId)
          ? <button ref={node => itemRefs.current!.set(activeId, node)} />
          : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes a defaulted intrinsic ref callback parameter", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(new Map());
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId)
          ? <button ref={(node = null) => itemRefs.current.set(activeId, node)} />
          : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows ref-backed DOM maps to delete unmounted nodes", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(new Map());
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId) ? (
          <button
            ref={node => {
              if (node) itemRefs.current.set(activeId, node);
              else itemRefs.current.delete(activeId);
            }}
          />
        ) : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows read-only access to a ref-backed DOM map", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(new Map());
        const hasActiveRef = itemRefs.current.has(activeId);
        const refCount = itemRefs.current.size;
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId) ? (
          <>
            <button ref={node => itemRefs.current.set(activeId, node)} />
            <output>{hasActiveRef ? refCount : 0}</output>
          </>
        ) : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["focus", "scrollIntoView", "select", "getBoundingClientRect"])(
    "treats committed DOM %s calls as external synchronization",
    (methodName) => {
      const result = runRule(
        noEffectChain,
        `function CommittedDomSync({ activeId }) {
          const [isMounted, setIsMounted] = useState(false);
          const nodeRef = useRef(null);
          useEffect(() => { setIsMounted(true); }, [activeId]);
          useEffect(() => { nodeRef.current?.${methodName}(); }, [isMounted]);
          return isMounted ? <input ref={nodeRef} /> : null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(['["focus"]', "[`scrollIntoView`]", "focus"])(
    "follows static DOM method spelling %s through a synchronous helper",
    (methodAccess) => {
      const result = runRule(
        noEffectChain,
        `function CommittedDomSync({ activeId }) {
          const [isMounted, setIsMounted] = useState(false);
          const nodeRef = useRef(null);
          const synchronizeNode = () => nodeRef.current?.${methodAccess}();
          useEffect(() => { setIsMounted(true); }, [activeId]);
          useEffect(() => { synchronizeNode(); }, [isMounted]);
          return isMounted ? <input ref={nodeRef} /> : null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("treats measurement on a React Native host ref as external synchronization", () => {
    const result = runRule(
      noEffectChain,
      `import { View } from "react-native";
      function NativeMeasurement({ activeId }) {
        const [isMounted, setIsMounted] = useState(false);
        const viewRef = useRef(null);
        useEffect(() => { setIsMounted(true); }, [activeId]);
        useEffect(() => {
          viewRef.current?.measure(() => undefined);
        }, [isMounted]);
        return isMounted ? <View ref={viewRef} /> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["focus", "measure", "select"])(
    "keeps a non-DOM %s method conservative",
    (methodName) => {
      const result = runRule(
        noEffectChain,
        `function DerivedSelection({ controller }) {
          const [source, setSource] = useState(0);
          const controllerRef = useRef(controller);
          useEffect(() => { setSource(1); }, []);
          useEffect(() => { controllerRef.current.${methodName}(source); }, [source]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("keeps a ref shared with a custom component conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain() {
        const [source, setSource] = useState(0);
        const controllerRef = useRef(null);
        useEffect(() => { setSource(1); }, []);
        useEffect(() => { controllerRef.current?.focus(); }, [source]);
        return (
          <>
            <input ref={controllerRef} />
            <Controller ref={controllerRef} />
          </>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a ref-backed collection with non-DOM initial values conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain({ controller }) {
        const [source, setSource] = useState(0);
        const controllerRefs = useRef(new Map([["primary", controller]]));
        useEffect(() => { setSource(1); }, []);
        useEffect(() => { controllerRefs.current.get("primary")?.focus(); }, [source]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when committed DOM work is mixed with a local state update", () => {
    const result = runRule(
      noEffectChain,
      `function MixedChain() {
        const [isMounted, setIsMounted] = useState(false);
        const [status, setStatus] = useState("idle");
        const nodeRef = useRef(null);
        useEffect(() => { setIsMounted(true); }, []);
        useEffect(() => {
          nodeRef.current?.focus();
          setStatus(isMounted ? "ready" : "idle");
        }, [isMounted]);
        return <div>{status}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a dynamic method name conservative", () => {
    const result = runRule(
      noEffectChain,
      `function DynamicMethodChain({ methodName }) {
        const [isMounted, setIsMounted] = useState(false);
        const nodeRef = useRef(null);
        useEffect(() => { setIsMounted(true); }, []);
        useEffect(() => { nodeRef.current?.[methodName](); }, [isMounted, methodName]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
