import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import type { RunRuleResult } from "../../../test-utils/run-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectChain } from "./no-effect-chain.js";

interface ExternalSyncChainFixture {
  moduleCode?: string;
  componentSetup?: string;
  componentParameters?: string;
  work: string;
}

const runExternalSyncChain = (
  fixture: ExternalSyncChainFixture,
  throughStableCallback = false,
): RunRuleResult => {
  const stableCallbackDeclaration = throughStableCallback
    ? `const synchronize = React.useCallback(() => { ${fixture.work} }, [intermediate]);`
    : "";
  const effectWork = throughStableCallback ? "synchronize();" : fixture.work;
  return runRule(
    noEffectChain,
    `${fixture.moduleCode ?? ""}
    import * as React from "react";
    function Widget({ source${fixture.componentParameters ? `, ${fixture.componentParameters}` : ""} }) {
      const [intermediate, setIntermediate] = React.useState(source);
      const [target, setTarget] = React.useState(source);
      ${fixture.componentSetup ?? ""}
      ${stableCallbackDeclaration}
      React.useEffect(() => setIntermediate(source), [source]);
      React.useEffect(() => { ${effectWork} setTarget(intermediate); }, [intermediate]);
      return target;
    }`,
  );
};

const WRAPPED_RECEIVER_MUTATION_FIXTURES = [
  ["type assertion", "(axios.defaults as any)"],
  ["satisfies wrapper", "(axios.defaults satisfies any)"],
  ["non-null assertion", "axios.defaults!"],
].flatMap(([wrapperName, receiver]) => [
  {
    name: `${wrapperName} assignment`,
    moduleCode: `import axios from "axios"; ${receiver}.adapter = consume;`,
  },
  {
    name: `${wrapperName} update`,
    moduleCode: `import axios from "axios"; ${receiver}.retryCount++;`,
  },
  {
    name: `${wrapperName} deletion`,
    moduleCode: `import axios from "axios"; delete ${receiver}.adapter;`,
  },
  {
    name: `${wrapperName} object-pattern target`,
    moduleCode: `import axios from "axios"; ({ adapter: ${receiver}.adapter } = { adapter: consume });`,
  },
  {
    name: `${wrapperName} array-pattern target`,
    moduleCode: `import axios from "axios"; [${receiver}.adapter] = [consume];`,
  },
  {
    name: `${wrapperName} for-of target`,
    moduleCode: `import axios from "axios"; for ({ adapter: ${receiver}.adapter } of [{ adapter: consume }]) { break; }`,
  },
]);

const getFixtureBindingSymbolId = (source: string, bindingName: string): number => {
  const parsed = parseFixture(source);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  let bindingSymbolId: number | null = null;
  walkAst(parsed.program, (node) => {
    if (!isNodeOfType(node, "Identifier") || node.name !== bindingName) return;
    const symbol = scopes.symbolFor(node);
    if (symbol?.bindingIdentifier === node) bindingSymbolId = symbol.id;
  });
  if (bindingSymbolId === null) throw new Error(`Missing fixture binding: ${bindingName}`);
  return bindingSymbolId;
};

const buildReaderFrameCollisionFixture = (
  earlyReturnValue: string,
  readerCalls: string,
): string => `function Widget({ source }) {
  const [intermediate, setIntermediate] = useState(false);
  const [target, setTarget] = useState(false);
  const performWork = (firstValue, secondValue) => {
    if (firstValue === ${JSON.stringify(earlyReturnValue)}) return;
    setTarget(intermediate);
  };
  useEffect(() => setIntermediate(true), [source]);
  useEffect(() => { ${readerCalls} }, [intermediate]);
  return target;
}`;

describe("no-effect-chain — regressions", () => {
  it("reports effect chains through effect, setter, and dependency aliases", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      const runEffect = useEffect;
      const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        const writeStep = setStep;
        const writeReady = setReady;
        const currentStep = step;
        runEffect(() => writeStep(1), [source, writeStep]);
        runEffect(() => {
          if (currentStep > 0) writeReady(true);
        }, [currentStep, writeReady]);
        return ready;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an effect chain when the writer explicitly returns a setter alias call", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        const writeStep = setStep;
        useEffect(() => {
          return writeStep(1);
        }, [source]);
        useEffect(() => setReady(step > 0), [step]);
        return ready;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a chain through a member dependency of state", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      const Example = ({ source }) => {
        const [state, setState] = useState({ step: 0 });
        const [ready, setReady] = useState(false);
        useEffect(() => setState({ step: 1 }), [source]);
        useEffect(() => {
          if (state.step > 0) setReady(true);
        }, [state.step]);
        return ready;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a userland effect",
      `const useEffect = (callback) => callback();
      const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        useEffect(() => setStep(1), [source]);
        useEffect(() => setReady(step > 0), [step]);
        return ready;
      };`,
    ],
    [
      "a mutable setter alias",
      `import { useEffect, useState } from "react";
      const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        let writeStep = setStep;
        writeStep = console.log;
        useEffect(() => writeStep(1), [source]);
        useEffect(() => setReady(step > 0), [step]);
        return ready;
      };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = runRule(noEffectChain, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
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

  it("reports a state-copy writer hidden behind React useCallback", () => {
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

  it("reports conditional writes to one state through a stable callback", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const copyIntermediate = useCallback(() => {
          if (source) setIntermediate(source);
          else setIntermediate(null);
        }, [source]);
        useEffect(() => copyIntermediate(), [copyIntermediate]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an opaque call", "synchronize();"],
    ["a property mutation", "scratch.value = source;"],
  ])("keeps a stable state writer with %s conservative", (_, extraWork) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ scratch, source, synchronize }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const copyIntermediate = useCallback(() => {
          ${extraWork}
          setIntermediate(source);
        }, [scratch, source, synchronize]);
        useEffect(() => copyIntermediate(), [copyIntermediate]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a shadowed callback parameter as the component setter", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source, writeValue }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const copyIntermediate = useCallback((setIntermediate) => {
          setIntermediate(source);
        }, [source]);
        useEffect(() => copyIntermediate(writeValue), [copyIntermediate, writeValue]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a stable writer conservative when the effect also writes another state", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source }) {
        const [anchor, setAnchor] = useState(source);
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const copyIntermediate = useCallback(() => setIntermediate(source), [source]);
        useEffect(() => {
          setAnchor(source);
          copyIntermediate();
        }, [copyIntermediate, source]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return anchor ? target : intermediate;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "an opaque default-parameter call",
      extraState: "",
      callback: "(ignored = synchronize()) => { void ignored; setIntermediate(source); }",
      output: "target",
    },
    {
      name: "a second state write in a default parameter",
      extraState: 'const [other, setOther] = useState("");',
      callback: "(ignored = setOther(source)) => { void ignored; setIntermediate(source); }",
      output: "String(target) + String(other)",
    },
    {
      name: "a dynamic import",
      extraState: "",
      callback: '() => { void import("./worker"); setIntermediate(source); }',
      output: "target",
    },
  ])("keeps a stable state writer with $name conservative", (fixture) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source, synchronize }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        ${fixture.extraState}
        const copyIntermediate = useCallback(${fixture.callback}, [source, synchronize]);
        useEffect(() => copyIntermediate(), [copyIntermediate]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return ${fixture.output};
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "stable callback",
      "const initializeIntermediate = () => { setIntermediate(source); return source; }; const transition = useCallback((ignored = initializeIntermediate()) => { void ignored; }, [source]);",
    ],
    [
      "ordinary local helper",
      "const initializeIntermediate = () => { setIntermediate(source); return source; }; const transition = (ignored = initializeIntermediate()) => { void ignored; };",
    ],
  ])("does not execute a supplied $name default parameter", (_, declaration) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        ${declaration}
        useEffect(() => transition("provided"), [transition]);
        useEffect(() => setTarget(intermediate), [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(
    ["setTimeout", "fetch", "queueMicrotask"].flatMap((calleeName) => [
      [calleeName, "direct", "", `${calleeName}(consume);`],
      [
        calleeName,
        "stable callback",
        `const synchronize = React.useCallback(() => ${calleeName}(consume), []);`,
        "synchronize();",
      ],
    ]),
  )(
    "stays silent for a global %s call through a %s form",
    (_calleeName, _callShape, declaration, call) => {
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        ${declaration}
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["direct", "stable callback"])(
    "stays silent for a global ResizeObserver through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const synchronize = React.useCallback(() => new ResizeObserver(consume), []);"
          : "";
      const call =
        callShape === "stable callback" ? "synchronize();" : "new ResizeObserver(consume);";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["direct", "stable callback"])(
    "flags a chain for a prop named ResizeObserver through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const derive = React.useCallback(() => new ResizeObserver(consume), [ResizeObserver]);"
          : "";
      const call = callShape === "stable callback" ? "derive();" : "new ResizeObserver(consume);";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source, ResizeObserver }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(["direct", "stable callback"])(
    "stays silent for global localStorage through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const synchronize = React.useCallback(() => localStorage.setItem('value', intermediate), [intermediate]);"
          : "";
      const call =
        callShape === "stable callback"
          ? "synchronize();"
          : "localStorage.setItem('value', intermediate);";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["direct", "stable callback"])(
    "flags a chain for a prop named localStorage through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const derive = React.useCallback(() => localStorage.setItem('value', intermediate), [intermediate, localStorage]);"
          : "";
      const call =
        callShape === "stable callback"
          ? "derive();"
          : "localStorage.setItem('value', intermediate);";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source, localStorage }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(
    ["setTimeout", "fetch", "queueMicrotask", "ky", "got", "wretch", "ofetch"].flatMap(
      (calleeName) => [
        [calleeName, "direct", "", `${calleeName}(intermediate);`],
        [
          calleeName,
          "stable callback",
          `const derive = React.useCallback(() => ${calleeName}(intermediate), [intermediate, ${calleeName}]);`,
          "derive();",
        ],
      ],
    ),
  )(
    "flags a chain when a prop named %s is called through a %s form",
    (calleeName, _callShape, declaration, call) => {
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
      function Widget({ source, ${calleeName} }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        ${declaration}
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(
    ["setTimeout", "fetch"].flatMap((calleeName) =>
      ["local", "import"].flatMap((bindingKind) =>
        ["direct", "stable callback"].map((callShape) => [calleeName, bindingKind, callShape]),
      ),
    ),
  )(
    "flags a chain for a %s-named %s binding through a %s form",
    (calleeName, bindingKind, callShape) => {
      const binding =
        bindingKind === "import"
          ? `import { ${calleeName} } from "./userland";`
          : `const ${calleeName} = consume;`;
      const callback =
        callShape === "stable callback"
          ? `const derive = React.useCallback(() => ${calleeName}(intermediate), [intermediate]);`
          : "";
      const call = callShape === "stable callback" ? "derive();" : `${calleeName}(intermediate);`;
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
      ${bindingKind === "import" ? binding : ""}
      function Widget({ source }) {
        ${bindingKind === "local" ? binding : ""}
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        ${callback}
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    ["node-fetch", 'import fetch from "node-fetch";', "fetch(intermediate);"],
    ["undici", 'import { fetch } from "undici";', "fetch(intermediate);"],
    ["ky", 'import ky from "ky";', "ky(intermediate);"],
    ["got", 'import got from "got";', "got(intermediate);"],
    ["wretch", 'import wretch from "wretch";', "wretch(intermediate);"],
    ["ofetch", 'import { ofetch } from "ofetch";', "ofetch(intermediate);"],
  ])("stays silent for a proven %s client import", (_clientName, importStatement, call) => {
    const result = runRule(
      noEffectChain,
      `${importStatement}
      function Widget({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["direct", "stable callback"])(
    "stays silent for a proven React ref write through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const synchronize = React.useCallback(() => { bookkeeping.current = intermediate; }, [intermediate]);"
          : "";
      const call =
        callShape === "stable callback" ? "synchronize();" : "bookkeeping.current = intermediate;";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          const bookkeeping = React.useRef(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["direct", "stable callback"])(
    "stays silent for an immutable React ref alias write through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const synchronize = React.useCallback(() => { bookkeepingAlias.current = intermediate; }, [intermediate]);"
          : "";
      const call =
        callShape === "stable callback"
          ? "synchronize();"
          : "bookkeepingAlias.current = intermediate;";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          const bookkeeping = React.useRef(source);
          const bookkeepingAlias = bookkeeping;
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["direct", "stable callback"])(
    "flags a chain for an arbitrary .current write through a %s form",
    (callShape) => {
      const callback =
        callShape === "stable callback"
          ? "const derive = React.useCallback(() => { bookkeeping.current = intermediate; }, [bookkeeping, intermediate]);"
          : "";
      const call =
        callShape === "stable callback" ? "derive();" : "bookkeeping.current = intermediate;";
      const result = runRule(
        noEffectChain,
        `import * as React from "react";
        function Widget({ source, bookkeeping }) {
          const [intermediate, setIntermediate] = React.useState(source);
          const [target, setTarget] = React.useState(source);
          ${callback}
          React.useEffect(() => setIntermediate(source), [source]);
          React.useEffect(() => { ${call} setTarget(intermediate); }, [intermediate]);
          return target;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    {
      name: "renamed undici fetch",
      moduleCode: 'import { fetch as request } from "undici";',
      work: "request(intermediate);",
    },
    {
      name: "renamed node-fetch default",
      moduleCode: 'import request from "node-fetch";',
      work: "request(intermediate);",
    },
    {
      name: "renamed node timer",
      moduleCode: 'import { setTimeout as schedule } from "node:timers";',
      work: "schedule(consume);",
    },
    {
      name: "node timer namespace",
      moduleCode: 'import * as timers from "node:timers";',
      work: "timers.setTimeout(consume);",
    },
  ])("stays silent for a proven $name import in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    {
      name: "renamed unrelated undici export",
      moduleCode: 'import { inspect as fetch } from "undici";',
      work: "fetch(intermediate);",
    },
    {
      name: "unrelated namespace fetch",
      moduleCode: 'import * as userClient from "./user-client";',
      work: "userClient.fetch(intermediate);",
    },
    {
      name: "same-named userland default",
      moduleCode: 'import fetch from "./user-client";',
      work: "fetch(intermediate);",
    },
  ])("flags a chain for a $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "callable CommonJS default",
      moduleCode: 'const request = require("node-fetch");',
      work: "request(intermediate);",
    },
    {
      name: "renamed CommonJS export",
      moduleCode: 'const { fetch: request } = require("undici");',
      work: "request(intermediate);",
    },
    {
      name: "renamed CommonJS timer",
      moduleCode: 'const { setTimeout: schedule } = require("node:timers");',
      work: "schedule(consume);",
    },
    {
      name: "CommonJS timer namespace",
      moduleCode: 'const timers = require("node:timers");',
      work: "timers.setTimeout(consume);",
    },
    {
      name: "CommonJS axios receiver",
      moduleCode: 'const client = require("axios");',
      work: 'client.get("/rows");',
    },
    {
      name: "TypeScript import-equals timer namespace",
      moduleCode: 'import timers = require("node:timers");',
      work: "timers.setTimeout(consume);",
    },
    {
      name: "TypeScript import-equals callable default",
      moduleCode: 'import request = require("node-fetch");',
      work: "request(intermediate);",
    },
  ])("stays silent for a proven $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    ...WRAPPED_RECEIVER_MUTATION_FIXTURES.map((fixture) => ({
      ...fixture,
      work: 'axios.get("/rows");',
    })),
    {
      name: "mutated imported axios receiver",
      moduleCode: 'import axios from "axios"; axios.post = () => undefined;',
      work: 'axios.post("/rows", intermediate);',
    },
    {
      name: "mutated imported axios receiver through an alias",
      moduleCode:
        'import axios from "axios"; const axiosAlias = axios; axiosAlias.post = () => undefined;',
      work: 'axios.post("/rows", intermediate);',
    },
    {
      name: "nested imported axios receiver mutation",
      moduleCode: 'import axios from "axios"; axios.defaults.adapter = consume;',
      work: 'axios.get("/rows");',
    },
    {
      name: "nested imported axios receiver mutation through a type assertion",
      moduleCode: 'import axios from "axios"; (axios.defaults as any).adapter = consume;',
      work: 'axios.get("/rows");',
    },
    {
      name: "nested imported axios receiver mutation through a non-null assertion",
      moduleCode: 'import axios from "axios"; axios.defaults!.adapter = consume;',
      work: 'axios.get("/rows");',
    },
    {
      name: "computed nested imported axios receiver mutation through a type assertion",
      moduleCode: 'import axios from "axios"; (axios["defaults"] as any)["adapter"] = consume;',
      work: 'axios.get("/rows");',
    },
    {
      name: "optional nested imported axios receiver deletion",
      moduleCode: 'import axios from "axios"; delete axios.defaults?.adapter;',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through object destructuring",
      moduleCode: 'import axios from "axios"; ({ get: axios.get } = { get: consume });',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through array destructuring",
      moduleCode: 'import axios from "axios"; [axios.get] = [consume];',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through a destructuring default",
      moduleCode: 'import axios from "axios"; ({ get: axios.get = consume } = {});',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through a rest target",
      moduleCode: 'import axios from "axios"; ({ ...axios.defaults } = { baseURL: "/rows" });',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through a for-of target",
      moduleCode:
        'import axios from "axios"; for ({ get: axios.get } of [{ get: consume }]) { break; }',
      work: 'axios.get("/rows");',
    },
    {
      name: "imported axios receiver mutated through a for-in target",
      moduleCode: 'import axios from "axios"; for ([axios.get] in { row: 1 }) { break; }',
      work: 'axios.get("/rows");',
    },
    {
      name: "mutated axios instance",
      moduleCode: 'import axios from "axios";',
      componentSetup: "const client = axios.create(); client.get = () => undefined;",
      work: 'client.get("/rows");',
    },
    {
      name: "mutated axios instance through an alias",
      moduleCode: 'import axios from "axios";',
      componentSetup:
        "const client = axios.create(); const clientAlias = client; clientAlias.get = () => undefined;",
      work: 'client.get("/rows");',
    },
  ])("flags a chain for a $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "object destructuring read",
      moduleCode:
        'import axios from "axios"; const { get: importedGet } = axios; void importedGet;',
    },
    {
      name: "array destructuring read",
      moduleCode: 'import axios from "axios"; const [importedGet] = [axios.get]; void importedGet;',
    },
    {
      name: "object destructuring assignment read",
      moduleCode: 'import axios from "axios"; let get; ({ get } = axios); void get;',
    },
    {
      name: "object rest assignment read",
      moduleCode: 'import axios from "axios"; let copy; ({ ...copy } = axios); void copy;',
    },
  ])("stays silent after an imported axios $name", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(
        {
          ...fixture,
          work: 'axios.get("/rows");',
        },
        throughStableCallback,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("keeps an array destructuring assignment from an imported receiver conservative", () => {
    const result = runExternalSyncChain({
      moduleCode:
        'import axios from "axios"; let importedGet; [importedGet] = axios; void importedGet;',
      work: 'axios.get("/rows");',
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "shadowed require",
      moduleCode:
        'const require = () => ({ fetch: consume }); const { fetch } = require("undici");',
      work: "fetch(intermediate);",
    },
    {
      name: "unrelated CommonJS export",
      moduleCode: 'const { inspect: fetch } = require("undici");',
      work: "fetch(intermediate);",
    },
  ])("flags a chain for a $name binding in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "nested CommonJS timer member",
      moduleCode: 'const timers = require("node:timers");',
      work: "timers.custom.setTimeout(consume);",
    },
    {
      name: "aliased nested CommonJS timer member",
      moduleCode: 'const timers = require("node:timers"); const customTimers = timers.custom;',
      work: "customTimers.setTimeout(consume);",
    },
    {
      name: "nested undici member",
      moduleCode: 'const client = require("undici");',
      work: 'client.custom.fetch("/rows");',
    },
    {
      name: "nested destructured CommonJS timer member",
      moduleCode: 'const { custom: { setTimeout: schedule } } = require("node:timers");',
      work: "schedule(consume);",
    },
    {
      name: "mutated CommonJS timer member",
      moduleCode: 'const timers = require("node:timers"); timers.setTimeout = consume;',
      work: "timers.setTimeout(consume);",
    },
    {
      name: "mutated CommonJS timer member through an alias",
      moduleCode:
        'const timers = require("node:timers"); const timerAlias = timers; timerAlias.setTimeout = consume;',
      work: "timers.setTimeout(consume);",
    },
    {
      name: "mutated CommonJS axios receiver",
      moduleCode: 'const client = require("axios"); client.get = consume;',
      work: 'client.get("/rows");',
    },
    {
      name: "mutated CommonJS axios receiver through an alias",
      moduleCode:
        'const client = require("axios"); const clientAlias = client; clientAlias.get = consume;',
      work: 'client.get("/rows");',
    },
    {
      name: "mutated CommonJS undici receiver",
      moduleCode: 'const client = require("undici"); client.request = consume;',
      work: 'client.request("/rows");',
    },
  ])("flags a chain for a $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "globalThis timer member",
      work: "globalThis.setTimeout(consume);",
    },
    {
      name: "window scheduler member",
      work: "window.queueMicrotask(consume);",
    },
    {
      name: "const global timer alias",
      componentSetup: "const schedule = window.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "immutable wrapped global-object alias chain",
      componentSetup:
        "const globalRoot = globalThis; const globalAlias = globalRoot; const schedule = (globalAlias as typeof globalThis).setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "renamed destructured globalThis self alias",
      componentSetup:
        "const { globalThis: globalRoot } = globalThis; const schedule = globalRoot.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "shorthand destructured window self alias",
      componentSetup: "const { window } = globalThis; const schedule = window.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "static-computed destructured self alias chain",
      componentSetup:
        'const { ["self"]: globalRoot } = globalThis; const globalAlias = globalRoot; const schedule = globalAlias.setTimeout;',
      work: "schedule(consume);",
    },
    {
      name: "destructured global timer alias",
      componentSetup: "const { setTimeout: schedule } = globalThis;",
      work: "schedule(consume);",
    },
    {
      name: "shorthand destructured global timer",
      componentSetup: "const { setTimeout } = globalThis;",
      work: "setTimeout(consume);",
    },
    {
      name: "static-computed destructured global timer alias",
      componentSetup: 'const { ["setTimeout"]: schedule } = globalThis;',
      work: "schedule(consume);",
    },
    {
      name: "immutable destructured global timer alias chain",
      componentSetup:
        "const { setTimeout: schedule } = globalThis; const scheduleAlias = schedule;",
      work: "scheduleAlias(consume);",
    },
  ])("stays silent for a proven $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    {
      name: "nested destructured global timer alias",
      componentSetup: "const { schedulerContainer: { setTimeout: schedule } } = globalThis;",
      work: "schedule(consume);",
    },
    {
      name: "defaulted destructured global timer alias",
      componentSetup: "const { setTimeout: schedule = consume } = globalThis;",
      work: "schedule(consume);",
    },
    {
      name: "global timer default from an unknown object property",
      componentSetup: "const { schedule = setTimeout } = getScheduler();",
      work: "schedule(consume);",
    },
    {
      name: "rest-copied global timer root",
      componentSetup: "const { ...scheduler } = globalThis; const schedule = scheduler.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "nested-destructured global timer root",
      componentSetup:
        "const { schedulerContainer: scheduler } = globalThis; const schedule = scheduler.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "defaulted destructured global self root",
      componentSetup:
        "const { window: globalRoot = globalThis } = globalThis; const schedule = globalRoot.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "nested destructured global self root",
      componentSetup:
        "const { environment: { window: globalRoot } } = globalThis; const schedule = globalRoot.setTimeout;",
      work: "schedule(consume);",
    },
    {
      name: "dynamic-computed destructured global timer alias",
      componentSetup:
        'const timerName = "setTimeout"; const { [timerName]: schedule } = globalThis;',
      work: "schedule(consume);",
    },
    {
      name: "assignment-destructured global timer alias",
      componentSetup: "let schedule; ({ setTimeout: schedule } = globalThis);",
      work: "schedule(consume);",
    },
    {
      name: "parameter-destructured global timer alias",
      componentParameters: "setTimeout: schedule",
      work: "schedule(consume);",
    },
  ])("flags a chain for a conservative $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "shadowed globalThis timer",
      componentParameters: "globalThis",
      work: "globalThis.setTimeout(consume);",
    },
    {
      name: "shadowed window scheduler",
      componentParameters: "window",
      work: "window.queueMicrotask(consume);",
    },
  ])("flags a chain for a $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "window observer constructor",
      work: "new window.ResizeObserver(consume);",
    },
    {
      name: "const observer constructor alias",
      componentSetup: "const Observer = ResizeObserver;",
      work: "new Observer(consume);",
    },
  ])("stays silent for a proven $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("flags an observer constructor on a shadowed window object", () => {
    const result = runExternalSyncChain({
      componentParameters: "window",
      work: "new window.ResizeObserver(consume);",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for destructured browser storage through direct and stable callback forms", () => {
    const fixture = {
      componentSetup: "const { localStorage: storage } = window;",
      work: "storage.setItem('value', String(intermediate));",
    };
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("flags destructured storage from a shadowed window object", () => {
    const result = runExternalSyncChain({
      componentParameters: "window",
      componentSetup: "const { localStorage: storage } = window;",
      work: "storage.setItem('value', String(intermediate));",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "createRef alias",
      componentSetup: "const bookkeeping = React.createRef(); const alias = bookkeeping;",
      work: "alias.current = intermediate;",
    },
    {
      name: "computed useRef current",
      componentSetup: "const bookkeeping = React.useRef(source);",
      work: "bookkeeping['current'] = intermediate;",
    },
    {
      name: "multi-hop createRef alias with computed current",
      componentSetup:
        "const bookkeeping = React.createRef(); const firstAlias = bookkeeping; const secondAlias = firstAlias;",
      work: "secondAlias['current'] = intermediate;",
    },
    {
      name: "useRef current update",
      componentSetup: "const bookkeeping = React.useRef(source);",
      work: "bookkeeping.current++;",
    },
  ])(
    "stays silent for a proven React $name write in direct and stable callback forms",
    (fixture) => {
      for (const throughStableCallback of [false, true]) {
        const result = runExternalSyncChain(fixture, throughStableCallback);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    },
  );

  it("flags a computed current write on an arbitrary object", () => {
    const result = runExternalSyncChain({
      componentParameters: "bookkeeping",
      work: "bookkeeping['current'] = intermediate;",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "imported axios mutation",
      moduleCode: 'import axios from "axios";',
      work: "axios.post('/value', intermediate);",
    },
    {
      name: "axios instance request",
      moduleCode: 'import axios from "axios";',
      componentSetup: "const client = axios.create();",
      work: "client.request({ url: '/value' });",
    },
    {
      name: "window event subscription",
      work: "window.addEventListener('change', consume);",
    },
    {
      name: "observer disconnection",
      componentSetup: "const observer = new ResizeObserver(consume);",
      work: "observer.disconnect();",
    },
  ])("stays silent for a proven $name in direct and stable callback forms", (fixture) => {
    for (const throughStableCallback of [false, true]) {
      const result = runExternalSyncChain(fixture, throughStableCallback);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each(["fetch", "post", "request", "connect", "subscribe"])(
    "flags a chain for an arbitrary member method named %s in direct and stable callback forms",
    (methodName) => {
      const fixture = {
        componentParameters: "service",
        work: `service.${methodName}(intermediate);`,
      };
      for (const throughStableCallback of [false, true]) {
        const result = runExternalSyncChain(fixture, throughStableCallback);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      }
    },
  );

  it("stays silent for a static computed timer namespace export", () => {
    const result = runExternalSyncChain({
      moduleCode: 'import * as timers from "node:timers";',
      work: "timers['setTimeout'](consume);",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a dynamic computed timer namespace export conservative", () => {
    const result = runExternalSyncChain({
      moduleCode: 'import * as timers from "node:timers";',
      componentParameters: "methodName",
      work: "timers[methodName](consume);",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a dynamic computed React ref property conservative", () => {
    const result = runExternalSyncChain({
      componentParameters: "propertyName",
      componentSetup: "const bookkeeping = React.useRef(source);",
      work: "bookkeeping[propertyName] = intermediate;",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves conditionally invoked proven and userland stable callbacks separately", () => {
    const externalResult = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, enabled }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const synchronize = React.useCallback(() => globalThis.setTimeout(consume), []);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => {
          if (enabled) synchronize();
          setTarget(intermediate);
        }, [enabled, intermediate, synchronize]);
        return target;
      }`,
    );
    const userlandResult = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, enabled, setTimeout }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const derive = React.useCallback(() => setTimeout(intermediate), [intermediate, setTimeout]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => {
          if (enabled) derive();
          setTarget(intermediate);
        }, [derive, enabled, intermediate]);
        return target;
      }`,
    );
    expect(externalResult.parseErrors).toEqual([]);
    expect(externalResult.diagnostics).toEqual([]);
    expect(userlandResult.parseErrors).toEqual([]);
    expect(userlandResult.diagnostics).toHaveLength(1);
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

  it("reports a state-copy writer through a multi-hop stable callback alias", () => {
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
    ["implicit setter result", "() => setTarget(intermediate)"],
    ["block-bodied setter", "() => { setTarget(intermediate); }"],
    ["explicit setter result", "function () { return setTarget(intermediate); }"],
    ["explicit undefined after a setter", "() => { setTarget(intermediate); return undefined; }"],
    ["explicit null after a setter", "() => { setTarget(intermediate); return null; }"],
    ["explicit false after a setter", "() => { setTarget(intermediate); return false; }"],
    ["explicit number after a setter", "() => { setTarget(intermediate); return 0; }"],
    ["explicit string after a setter", "() => { setTarget(intermediate); return 'done'; }"],
    [
      "explicit template string after a setter",
      "() => { setTarget(intermediate); return `done`; }",
    ],
    ["explicit void after a setter", "() => { setTarget(intermediate); return void noop(); }"],
    ["explicit object after a setter", "() => { setTarget(intermediate); return {}; }"],
    ["explicit array after a setter", "() => { setTarget(intermediate); return []; }"],
    [
      "all-non-cleanup conditional after a setter",
      "() => { setTarget(intermediate); return intermediate ? undefined : null; }",
    ],
    [
      "global Boolean result after a setter",
      "() => { setTarget(intermediate); return Boolean(intermediate); }",
    ],
    [
      "global String result after a setter",
      "() => { setTarget(intermediate); return String(intermediate); }",
    ],
    ["global Symbol result after a setter", "() => { setTarget(intermediate); return Symbol(); }"],
    [
      "global Promise result after a setter",
      "() => { setTarget(intermediate); return Promise.resolve(intermediate); }",
    ],
    [
      "global constructed object after a setter",
      "() => { setTarget(intermediate); return new Date(); }",
    ],
    ["ignored helper result after a setter", "() => { setTarget(intermediate); noop(); }"],
  ])("reports through a stable reader with an explicitly returned %s", (_, callback) => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const updateTarget = React.useCallback(${callback}, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => { return updateTarget(); }, [intermediate, updateTarget]);
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
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          const unsubscribe = subscribe(intermediate);
          return () => unsubscribe();
        }, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => { return subscribeAndUpdateTarget(); },
          [intermediate, subscribeAndUpdateTarget],
        );
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a concise effect returns a stable callback's cleanup function", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          const unsubscribe = subscribe(intermediate);
          return () => unsubscribe();
        }, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => subscribeAndUpdateTarget(),
          [intermediate, subscribeAndUpdateTarget],
        );
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["bare return", "return;"],
    ["global undefined", "return undefined;"],
  ])("stays silent when a concise stable callback returns cleanup or $name", (_, earlyReturn) => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, enabled }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          if (!enabled) ${earlyReturn}
          const unsubscribe = subscribe(intermediate);
          return () => unsubscribe();
        }, [intermediate, enabled]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => subscribeAndUpdateTarget(),
          [intermediate, subscribeAndUpdateTarget],
        );
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not suppress a concise stable callback with a non-cleanup return branch", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source, shouldSubscribe }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          const unsubscribe = subscribe(intermediate);
          return shouldSubscribe ? (() => unsubscribe()) : { invalidCleanup: true };
        }, [intermediate, shouldSubscribe]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => subscribeAndUpdateTarget(),
          [intermediate, subscribeAndUpdateTarget],
        );
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an opaque result from a stable callback as concise cleanup", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const updateTargetAndReturnUnknown = React.useCallback(() => {
          setTarget(intermediate);
          return createUnknownValue(intermediate);
        }, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => updateTargetAndReturnUnknown(),
          [intermediate, updateTargetAndReturnUnknown],
        );
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the stable callback returns a resolved cleanup identifier", () => {
    const result = runRule(
      noEffectChain,
      `import * as React from "react";
      function Widget({ source }) {
        const [intermediate, setIntermediate] = React.useState(source);
        const [target, setTarget] = React.useState(source);
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          const unsubscribe = subscribe(intermediate);
          const cleanup = () => unsubscribe();
          return cleanup;
        }, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => { return subscribeAndUpdateTarget(); },
          [intermediate, subscribeAndUpdateTarget],
        );
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
        const subscribeAndUpdateTarget = React.useCallback(() => {
          setTarget(intermediate);
          const unsubscribe = subscribe(intermediate);
          return () => unsubscribe();
        }, [intermediate]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => { return subscribeAndUpdateTarget?.(); },
          [intermediate, subscribeAndUpdateTarget],
        );
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
        const updateTarget = React.useCallback(() => {
          setTarget(intermediate);
          return ${returnedValue.replaceAll("source", "intermediate")};
        }, [intermediate, ${parameter}]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(
          () => { return updateTarget(); },
          [intermediate, updateTarget],
        );
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
        const updateTarget = React.useCallback(() => {
          setTarget(intermediate);
          return intermediate ? undefined : cleanup;
        }, [intermediate, cleanup]);
        React.useEffect(() => setIntermediate(source), [source]);
        React.useEffect(() => { return updateTarget(); }, [intermediate, updateTarget]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an optional call to a proven stable state-copy writer", () => {
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

  it("reports a nested stable state-copy writer", () => {
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

  it("stays silent for the authentic lazy DOM ref Map focus sequence", () => {
    const result = runRule(
      noEffectChain,
      `function AccessibleNavTree({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef<Map<string, HTMLButtonElement | null> | null>(null);
        itemRefs.current ??= new Map();
        useEffect(() => {
          setExpanded(findAncestorPath(activeId));
        }, [activeId]);
        useEffect(() => {
          itemRefs.current?.get(activeId)?.focus();
        }, [activeId, expanded]);
        return expanded.has(activeId) ? (
          <button
            ref={node => {
              if (node) itemRefs.current?.set(activeId, node);
              else itemRefs.current?.delete(activeId);
            }}
          />
        ) : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a read-only intrinsic ref callback parameter has TypeScript wrappers", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef<Map<string, HTMLButtonElement> | null>(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, (node as HTMLButtonElement)!)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a reassigned intrinsic ref callback parameter conservative", () => {
    const result = runRule(
      noEffectChain,
      `function UserlandControllerChain({ activeId, controller }) {
        const [expanded, setExpanded] = useState(new Set());
        const [status, setStatus] = useState("idle");
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        const localController = { focus: () => setStatus("ready") };
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => {
          node = controller ?? localController;
          itemRefs.current?.set(activeId, node);
        }}>{status}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a destructuring-reassigned intrinsic ref callback parameter conservative", () => {
    const result = runRule(
      noEffectChain,
      `function UserlandControllerChain({ activeId, controllerRef }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => {
          ({ current: node } = controllerRef);
          itemRefs.current?.set(activeId, node);
        }} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a lazily initialized Map seeded with a controller conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain({ controller }) {
        const [source, setSource] = useState(0);
        const controllerRefs = useRef(null);
        controllerRefs.current ??= new Map([["primary", controller]]);
        useEffect(() => { setSource(1); }, []);
        useEffect(() => { controllerRefs.current.get("primary")?.focus(); }, [source]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["scrollIntoView", "select", "getBoundingClientRect"])(
    "treats lazy DOM ref Map %s calls as external synchronization",
    (methodName) => {
      const result = runRule(
        noEffectChain,
        `function CommittedDomSync({ activeId }) {
          const [expanded, setExpanded] = useState(new Set());
          const itemRefs = useRef<Map<string, HTMLButtonElement> | undefined>(undefined);
          itemRefs.current ??= new Map();
          useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
          useEffect(() => { itemRefs.current?.get(activeId)?.${methodName}(); }, [expanded]);
          return expanded.has(activeId)
            ? <button ref={node => itemRefs.current?.set(activeId, node)} />
            : null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("follows transparent wrappers around a lazy DOM ref Map", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef<Map<string, HTMLButtonElement> | null>(null);
        itemRefs.current ??= (new Map() satisfies Map<string, HTMLButtonElement>);
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return expanded.has(activeId)
          ? <button ref={node => itemRefs.current?.set(activeId, node)} />
          : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats an omitted useRef initial value as undefined", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef();
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a lazy DOM ref Map with a later reset conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ResettableDomMap({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current = null; }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a lazy Map that stores a prop controller conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain({ activeId, controller }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={() => itemRefs.current?.set(activeId, controller)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a lazy Map populated by a custom component ref conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <Controller ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps an escaped lazy DOM ref Map conservative", () => {
    const result = runRule(
      noEffectChain,
      `function EscapedDomMap({ activeId, registerRefs }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        registerRefs(itemRefs);
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a lazy Map built from a shadowed constructor conservative", () => {
    const result = runRule(
      noEffectChain,
      `function ImperativeControllerChain({ activeId, Map }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps logical-or Map initialization conservative", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const itemRefs = useRef(null);
        itemRefs.current ||= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => { itemRefs.current?.get(activeId)?.focus(); }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a state-to-state chain beside a lazy DOM ref Map", () => {
    const result = runRule(
      noEffectChain,
      `function MixedChain({ activeId }) {
        const [expanded, setExpanded] = useState(new Set());
        const [status, setStatus] = useState("idle");
        const itemRefs = useRef(null);
        itemRefs.current ??= new Map();
        useEffect(() => { setExpanded(findAncestorPath(activeId)); }, [activeId]);
        useEffect(() => {
          itemRefs.current?.get(activeId)?.focus();
          setStatus(expanded.has(activeId) ? "ready" : "idle");
        }, [expanded]);
        return <button ref={node => itemRefs.current?.set(activeId, node)}>{status}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("treats an immutable alias of an intrinsic host ref as external synchronization", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId }) {
        const [isMounted, setIsMounted] = useState(false);
        const nodeRef = useRef(null);
        const nodeAlias = nodeRef;
        useEffect(() => { setIsMounted(true); }, [activeId]);
        useEffect(() => { nodeAlias.current?.focus(); }, [isMounted]);
        return isMounted ? <input ref={nodeRef} /> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an escaped intrinsic host ref alias conservative", () => {
    const result = runRule(
      noEffectChain,
      `function CommittedDomSync({ activeId, register }) {
        const [isMounted, setIsMounted] = useState(false);
        const nodeRef = useRef(null);
        const nodeAlias = nodeRef;
        register(nodeAlias);
        useEffect(() => { setIsMounted(true); }, [activeId]);
        useEffect(() => { nodeAlias.current?.focus(); }, [isMounted]);
        return isMounted ? <input ref={nodeRef} /> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

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

  it("stays silent when a false write cannot reach a guarded helper call", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function RunProgress({ seriesId, synchronize }) {
        const [runActive, setRunActive] = useState(false);
        const [status, setStatus] = useState("idle");
        const loadFindings = useCallback(() => { synchronize(); setStatus("loaded"); }, [synchronize]);
        useEffect(() => { setRunActive(false); }, [seriesId]);
        useEffect(() => {
          if (!runActive) return;
          loadFindings();
        }, [runActive, loadFindings]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a truthy writer", "setRunActive(true);", "if (!runActive) return; loadFindings();"],
    ["work before the guard", "setRunActive(false);", "loadFindings(); if (!runActive) return;"],
    [
      "another reachable call site",
      "setRunActive(false);",
      "if (runActive) loadFindings(); loadFindings();",
    ],
  ])("reports guarded helper work with %s", (_, writerWork, readerWork) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function RunProgress({ seriesId, synchronize }) {
        const [runActive, setRunActive] = useState(false);
        const [status, setStatus] = useState("idle");
        const loadFindings = useCallback(() => { synchronize(); setStatus("loaded"); }, [synchronize]);
        useEffect(() => { ${writerWork} }, [seriesId]);
        useEffect(() => { ${readerWork} }, [runActive, loadFindings]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for the Medusa stable co-write callback", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function DataGrid({ matrix }) {
        const [anchor, setAnchor] = useState(null);
        const [rangeEnd, setRangeEnd] = useState(null);
        const setSingleRange = useCallback((coordinates) => {
          setAnchor(coordinates);
          setRangeEnd(coordinates);
        }, []);
        useEffect(() => {
          if (!anchor && matrix) {
            const coordinates = matrix.getFirstNavigableCell();
            if (coordinates) setSingleRange(coordinates);
          }
        }, [anchor, matrix, setSingleRange]);
        useEffect(() => {
          if (!anchor) return;
          if (rangeEnd) return;
          setRangeEnd(anchor);
        }, [anchor, rangeEnd]);
        return rangeEnd;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when an unknown correlated value can reach guarded work", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Status({ source }) {
        const [anchor, setAnchor] = useState(null);
        const [rangeEnd, setRangeEnd] = useState(null);
        const [status, setStatus] = useState("idle");
        useEffect(() => {
          setAnchor(source);
          setRangeEnd(source);
        }, [source]);
        useEffect(() => {
          if (anchor === true) return;
          if (anchor === "value") return;
          if (!anchor) return;
          setStatus(String(anchor));
        }, [anchor, rangeEnd]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "different values",
      "(anchorValue, rangeValue) => { setAnchor(anchorValue); setRangeEnd(rangeValue); }",
      "setSelection(coordinates, null);",
    ],
    [
      "mutually exclusive writes",
      "(coordinates, shouldSetAnchor) => { if (shouldSetAnchor) setAnchor(coordinates); else setRangeEnd(coordinates); }",
      "setSelection(coordinates, shouldSetAnchor);",
    ],
    [
      "multiple invocations",
      "(coordinates) => { setAnchor(coordinates); setRangeEnd(coordinates); }",
      "setSelection(coordinates); setSelection(fallbackCoordinates);",
    ],
    [
      "an early exit between writes",
      "(coordinates, skipRangeEnd) => { setAnchor(coordinates); if (skipRangeEnd) return; setRangeEnd(coordinates); }",
      "setSelection(coordinates, true);",
    ],
  ])("reports range correction after %s", (_, helper, invocation) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function DataGrid({ coordinates, fallbackCoordinates, shouldSetAnchor }) {
        const [anchor, setAnchor] = useState(null);
        const [rangeEnd, setRangeEnd] = useState(null);
        const setSelection = ${helper};
        useEffect(() => { ${invocation} }, [coordinates, fallbackCoordinates, shouldSetAnchor, setSelection]);
        useEffect(() => {
          if (!anchor) return;
          if (rangeEnd) return;
          setRangeEnd(anchor);
        }, [anchor, rangeEnd]);
        return rangeEnd;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for the AppFlowy useCallback writer followed by an async row load", () => {
    const result = runRule(
      noEffectChain,
      `import * as Y from "yjs";
      import { useCallback, useEffect, useState } from "react";
      import { useDatabaseContextOptional } from "@/application/database-yjs";
      function RelationItems({ cell }) {
        const context = useDatabaseContextOptional();
        const createRow = context?.createRow;
        const [rowIds, setRowIds] = useState([]);
        const [rows, setRows] = useState({});
        const handleUpdateRowIds = useCallback(() => {
          const data = cell?.data;
          if (!data || !(data instanceof Y.Array)) {
            setRowIds([]);
            return;
          }
          setRowIds(data.toJSON());
        }, [cell.data]);
        useEffect(() => {
          void (async () => {
            const entries = await Promise.all(
              rowIds.map(async (rowId) => [rowId, await createRow(rowId)]),
            );
            setRows(Object.fromEntries(entries));
          })();
        }, [createRow, rowIds]);
        useEffect(() => { handleUpdateRowIds(); }, [handleUpdateRowIds]);
        return rows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the AppFlowy async row-load shape through an ordinary local writer", () => {
    const result = runRule(
      noEffectChain,
      `import * as Y from "yjs";
      import { useEffect, useState } from "react";
      import { useDatabaseContextOptional } from "@/application/database-yjs";
      function RelationItems({ cell }) {
        const context = useDatabaseContextOptional();
        const createRow = context?.createRow;
        const [rowIds, setRowIds] = useState([]);
        const [rows, setRows] = useState({});
        const handleUpdateRowIds = () => {
          const data = cell?.data;
          if (!data || !(data instanceof Y.Array)) {
            setRowIds([]);
            return;
          }
          setRowIds(data.toJSON());
        };
        useEffect(() => {
          void (async () => {
            const entries = await Promise.all(
              rowIds.map(async (rowId) => [rowId, await createRow(rowId)]),
            );
            setRows(Object.fromEntries(entries));
          })();
        }, [createRow, rowIds]);
        useEffect(() => { handleUpdateRowIds(); }, [cell]);
        return rows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for an ordinary Payload-style convergent selection helper", () => {
    const result = runRule(
      noEffectChain,
      `function Selection({ source }) {
        const [selectedItemKey, setSelectedItemKey] = useState(null);
        const selectFirstItem = () => setSelectedItemKey("first");
        useEffect(() => { selectFirstItem(); }, [source]);
        useLayoutEffect(() => {
          if (selectedItemKey === null) selectFirstItem();
        }, [selectedItemKey]);
        return selectedItemKey;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a synchronous chain derived through a Yjs Array type check", () => {
    const result = runRule(
      noEffectChain,
      `import * as Y from "yjs";
      function RelationItems({ cell }) {
        const [rowIds, setRowIds] = useState([]);
        const [count, setCount] = useState(0);
        useEffect(() => {
          const data = cell?.data;
          setRowIds(data instanceof Y.Array ? data.toJSON() : []);
        }, [cell]);
        useEffect(() => { setCount(rowIds.length); }, [rowIds]);
        return count;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps nested async external work conservative", () => {
    const result = runRule(
      noEffectChain,
      `function Outer() {
        const NestedRows = ({ source }) => {
          const [rowIds, setRowIds] = useState([]);
          const [rows, setRows] = useState([]);
          useEffect(() => setRowIds(source), [source]);
          useEffect(() => {
            void (async () => {
              const loadedRows = await Promise.all(
                [...rowIds].map(async (rowId) => fetch("/rows/" + rowId)),
              );
              setRows(loadedRows);
            })();
          }, [rowIds]);
          return rows;
        };
        return NestedRows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a userland map callback conservative", () => {
    const result = runRule(
      noEffectChain,
      `function Loader({ scheduler, source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        useEffect(() => {
          setIntermediate(source);
          void (async () => {
            await Promise.all(scheduler.map(() => fetch("/rows")));
          })();
        }, [scheduler, source]);
        useEffect(() => { setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an awaited imported pure derivation", () => {
    const result = runRule(
      noEffectChain,
      `import { deriveLabels } from "./pure-math";
      function Labels({ source }) {
        const [rows, setRows] = useState([]);
        const [labels, setLabels] = useState([]);
        useEffect(() => { setRows(source); }, [source]);
        useEffect(() => {
          void (async () => {
            setLabels(await deriveLabels(rows));
          })();
        }, [rows]);
        return labels;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when Promise.all receives an uninvoked async function", () => {
    const result = runRule(
      noEffectChain,
      `function RelationItems({ source, loadRow }) {
        const [rowIds, setRowIds] = useState([]);
        const [rows, setRows] = useState([]);
        useEffect(() => setRowIds(source), [source]);
        useEffect(() => {
          void (async () => {
            await Promise.all([async () => loadRow(rowIds[0])]);
            setRows(rowIds);
          })();
        }, [loadRow, rowIds]);
        return rows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an async IIFE without await", "const next = rowIds.map(String); setRows(next);"],
    [
      "a Promise.resolve local derivation",
      "const next = await Promise.resolve(rowIds.map(String)); setRows(next);",
    ],
  ])("reports a local chain through %s", (_, asyncWork) => {
    const result = runRule(
      noEffectChain,
      `function RelationItems({ source }) {
        const [rowIds, setRowIds] = useState([]);
        const [rows, setRows] = useState([]);
        useEffect(() => { setRowIds(source); }, [source]);
        useEffect(() => { void (async () => { ${asyncWork} })(); }, [rowIds]);
        return rows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["prefetchQuery", "fetchQuery"])(
    "stays silent for a proven TanStack Query client %s call",
    (methodName) => {
      const result = runExternalSyncChain({
        moduleCode: `import { useQueryClient } from "@tanstack/react-query";`,
        componentSetup: `const queryClient = useQueryClient();`,
        work: `void queryClient.${methodName}({ queryKey: [intermediate] });`,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("stays silent when a proven TanStack Query client is also an effect dependency", () => {
    const result = runRule(
      noEffectChain,
      `import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void queryClient.prefetchQuery({ queryKey: [intermediate] });
          setTarget(intermediate);
        }, [intermediate, queryClient]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a direct immutable binding", "const callbackDependencies = [intermediate, queryClient];"],
    [
      "multi-hop immutable aliases",
      `const baseDependencies = [intermediate, queryClient];
       const callbackDependenciesAlias = baseDependencies;
       const callbackDependencies = callbackDependenciesAlias;`,
    ],
  ])("stays silent for a proven client in %s used by useCallback", (_, dependencySetup) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        ${dependencySetup}
        const prefetch = useCallback(
          () => queryClient.prefetchQuery({ queryKey: [intermediate] }),
          callbackDependencies,
        );
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void prefetch();
          setTarget(intermediate);
        }, [intermediate, prefetch]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["nested inline arrays", "", "[intermediate, [queryClient]]"],
    [
      "bound inner and outer arrays",
      `const innerDependencies = [queryClient];
       const callbackDependencies = [intermediate, innerDependencies];`,
      "callbackDependencies",
    ],
    [
      "a plain object element",
      `const callbackDependencies = [intermediate, { queryClient }];`,
      "callbackDependencies",
    ],
    [
      "nested bound plain objects",
      `const clientDependency = { queryClient };
       const nestedDependency = { clientDependency };
       const callbackDependencies = [intermediate, nestedDependency];`,
      "callbackDependencies",
    ],
    [
      "an immutable array spread copy",
      `const baseDependencies = [intermediate, queryClient];
       const callbackDependencies = [...baseDependencies];`,
      "callbackDependencies",
    ],
    [
      "an inline nested array spread copy",
      `const callbackDependencies = [intermediate, ...[queryClient]];`,
      "callbackDependencies",
    ],
    [
      "an immutable full array rest copy",
      `const baseDependencies = [intermediate, queryClient];
       const [...callbackDependencies] = baseDependencies;`,
      "callbackDependencies",
    ],
  ])("stays silent for a proven client in %s", (_, dependencySetup, dependencyArgument) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        ${dependencySetup}
        const prefetch = useCallback(
          () => queryClient.prefetchQuery({ queryKey: [intermediate] }),
          ${dependencyArgument},
        );
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void prefetch();
          setTarget(intermediate);
        }, [intermediate, prefetch]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a getter dependency",
      `const clientDependency = { get queryClient() { return queryClient; } };
       const callbackDependencies = [intermediate, clientDependency];`,
      "callbackDependencies",
    ],
    [
      "a computed dependency property",
      `const dependencyKey = "client";
       const clientDependency = { [dependencyKey]: queryClient };
       const callbackDependencies = [intermediate, clientDependency];`,
      "callbackDependencies",
    ],
    [
      "an unknown object spread",
      `const clientDependency = { ...source, queryClient };
       const callbackDependencies = [intermediate, clientDependency];`,
      "callbackDependencies",
    ],
    [
      "a nested container mutation",
      `const innerDependencies = [queryClient];
       innerDependencies.push(source);
       const callbackDependencies = [intermediate, innerDependencies];`,
      "callbackDependencies",
    ],
    [
      "an outer container mutation",
      `const innerDependencies = [queryClient];
       const callbackDependencies = [intermediate, innerDependencies];
       callbackDependencies.push(source);`,
      "callbackDependencies",
    ],
    [
      "a nested container reassignment",
      `let innerDependencies = [queryClient];
       innerDependencies = [source];
       const callbackDependencies = [intermediate, innerDependencies];`,
      "callbackDependencies",
    ],
    [
      "call construction",
      `const callbackDependencies = [intermediate, Array.of(queryClient)];`,
      "callbackDependencies",
    ],
    [
      "function construction",
      `const callbackDependencies = [intermediate, () => queryClient];`,
      "callbackDependencies",
    ],
    [
      "an unknown nested consumer",
      `const innerDependencies = [queryClient];
       consume(innerDependencies);
       const callbackDependencies = [intermediate, innerDependencies];`,
      "callbackDependencies",
    ],
    [
      "an unterminated nested alias",
      `const innerDependencies = [queryClient];
       const unusedDependencies = [...innerDependencies];
       const callbackDependencies = [intermediate, innerDependencies];`,
      "callbackDependencies",
    ],
    [
      "a userland dependency consumer",
      `const callbackDependencies = [intermediate, queryClient];
       useUserlandCallback(() => undefined, callbackDependencies);`,
      "callbackDependencies",
    ],
    [
      "a partial array rest copy",
      `const baseDependencies = [intermediate, queryClient];
       const [firstDependency, ...callbackDependencies] = baseDependencies;`,
      "callbackDependencies",
    ],
    [
      "a direct receiver spread",
      `const callbackDependencies = [intermediate, ...queryClient];`,
      "callbackDependencies",
    ],
    [
      "an object spread into an array",
      `const clientDependency = { queryClient };
       const callbackDependencies = [intermediate, ...clientDependency];`,
      "callbackDependencies",
    ],
  ])("reports a proven client with %s", (_, dependencySetup, dependencyArgument) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ consume, source, useUserlandCallback }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        ${dependencySetup}
        const prefetch = useCallback(
          () => queryClient.prefetchQuery({ queryKey: [intermediate] }),
          ${dependencyArgument},
        );
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void prefetch();
          setTarget(intermediate);
        }, [intermediate, prefetch]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a userland hook argument", `useUserlandCallback(() => undefined, callbackDependencies);`],
    ["a mutated dependency array", `callbackDependencies.push(source);`],
    ["an escaped dependency array", `registerDependencies(callbackDependencies);`],
  ])("reports a proven client when its dependency array has %s", (_, unsafeUse) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ registerDependencies, source, useUserlandCallback }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        const callbackDependencies = [intermediate, queryClient];
        ${unsafeUse}
        const prefetch = useCallback(
          () => queryClient.prefetchQuery({ queryKey: [intermediate] }),
          callbackDependencies,
        );
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void prefetch();
          setTarget(intermediate);
        }, [intermediate, prefetch]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a direct method replacement", "queryClient.prefetchQuery = () => undefined;"],
    [
      "an aliased method replacement",
      "const queryClientAlias = queryClient; queryClientAlias.prefetchQuery = () => undefined;",
    ],
  ])("reports a TanStack Query client after %s", (_, mutation) => {
    const result = runExternalSyncChain({
      moduleCode: `import { useQueryClient } from "@tanstack/react-query";`,
      componentSetup: `const queryClient = useQueryClient(); ${mutation}`,
      work: `void queryClient.prefetchQuery({ queryKey: [intermediate] });`,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a mutated TanStack Query client even when it is an effect dependency", () => {
    const result = runRule(
      noEffectChain,
      `import { useQueryClient } from "@tanstack/react-query";
      function QueryPrefetch({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        const queryClient = useQueryClient();
        queryClient.prefetchQuery = () => undefined;
        useEffect(() => setIntermediate(source), [source]);
        useEffect(() => {
          void queryClient.prefetchQuery({ queryKey: [intermediate] });
          setTarget(intermediate);
        }, [intermediate, queryClient]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a userland hook",
      `import { useQueryClient } from "./query-client";`,
      `const queryClient = useQueryClient();`,
    ],
    [
      "a shadowed hook",
      `import { useQueryClient } from "@tanstack/react-query";`,
      `const localUseQueryClient = () => ({ prefetchQuery() {} }); const queryClient = localUseQueryClient();`,
    ],
    ["a prop receiver", "", "const queryClient = source;"],
  ])("reports prefetchQuery on %s", (_, moduleCode, componentSetup) => {
    const result = runExternalSyncChain({
      moduleCode,
      componentSetup,
      work: `void queryClient.prefetchQuery({ queryKey: [intermediate] });`,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["Math.random", "Math.random()"],
    ["Date.now", "Date.now()"],
    ["a ref read", "sourceRef.current"],
    ["a property read", "source.value"],
  ])("keeps repeated setter convergence from %s conservative", (_, nextValue) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useRef, useState } from "react";
      function Selection({ source }) {
        const [selected, setSelected] = useState(null);
        const sourceRef = useRef(source);
        const select = () => { setSelected(${nextValue}); };
        useEffect(() => { select(); }, [source, select]);
        useEffect(() => { if (selected === null) select(); }, [selected, select]);
        return selected;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for the Payload stable selection callbacks", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useLayoutEffect, useState } from "react";
      function Selection({ editor, groups, source }) {
        const [selectedItemKey, setSelectedItemKey] = useState(null);
        const updateSelectedItem = useCallback((item) => {
          const rootElement = editor.getRootElement();
          if (rootElement !== null) {
            rootElement.setAttribute("aria-activedescendant", \`item-\${item.key}\`);
            setSelectedItemKey(item.key);
          }
        }, [editor]);
        const selectFirstItem = useCallback(() => {
          const allItems = groups.flatMap((group) => group.items);
          if (allItems.length) updateSelectedItem(allItems[0]);
        }, [groups, updateSelectedItem]);
        useEffect(() => { selectFirstItem(); }, [source, selectFirstItem]);
        useLayoutEffect(() => {
          if (groups === null) setSelectedItemKey(null);
          else if (selectedItemKey === null) selectFirstItem();
        }, [groups, selectedItemKey, selectFirstItem]);
        return selectedItemKey;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the Payload callback topology when it only performs one state transition", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useLayoutEffect, useState } from "react";
      function Selection({ item, source }) {
        const [selectedItemKey, setSelectedItemKey] = useState(null);
        const updateSelectedItem = useCallback((nextItem) => {
          setSelectedItemKey(nextItem.key);
        }, []);
        const selectFirstItem = useCallback(() => {
          if (item) updateSelectedItem(item);
        }, [item, updateSelectedItem]);
        useEffect(() => { selectFirstItem(); }, [source, selectFirstItem]);
        useLayoutEffect(() => {
          if (selectedItemKey === null) selectFirstItem();
        }, [selectedItemKey, selectFirstItem]);
        return selectedItemKey;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when guarded shared-helper convergence also performs a non-null reset", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useLayoutEffect, useState } from "react";
      function Selection({ items, source }) {
        const [selectedItemKey, setSelectedItemKey] = useState(null);
        const updateSelectedItem = (item) => {
          setSelectedItemKey(item.key);
        };
        const selectFirstItem = () => {
          const item = items[0];
          if (item) updateSelectedItem(item);
        };
        useEffect(() => { selectFirstItem(); }, [source, selectFirstItem]);
        useLayoutEffect(() => {
          if (items.length === 0) setSelectedItemKey(source.key);
          else if (selectedItemKey === null) selectFirstItem();
        }, [items, selectedItemKey, selectFirstItem, source]);
        return selectedItemKey;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an empty string", 'selectedItemKey === null || selectedItemKey === ""'],
    ["a numeric literal", "selectedItemKey === null || selectedItemKey === 42"],
  ])("reports when shared-helper convergence is also reachable for %s", (_, guard) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Selection({ items, source }) {
        const [selectedItemKey, setSelectedItemKey] = useState(null);
        const updateSelectedItem = (item) => setSelectedItemKey(item.key);
        const selectFirstItem = () => {
          const item = items[0];
          if (item) updateSelectedItem(item);
        };
        useEffect(() => { selectFirstItem(); }, [source, selectFirstItem]);
        useEffect(() => { if (${guard}) selectFirstItem(); }, [selectedItemKey, selectFirstItem]);
        return selectedItemKey;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports guarded shared-helper calls with different arguments", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Selection({ fallback, source }) {
        const [selected, setSelected] = useState(null);
        const helper = (item) => setSelected(item.key);
        useEffect(() => { helper(source); }, [helper, source]);
        useEffect(() => {
          if (selected === null) helper(fallback);
        }, [fallback, helper, selected]);
        return selected;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports guarded shared helpers with observable work", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Selection({ item, onSelect, source }) {
        const [selected, setSelected] = useState(null);
        const helper = () => {
          onSelect(item);
          setSelected(item.key);
        };
        useEffect(() => { helper(); }, [helper, source]);
        useEffect(() => {
          if (selected === null) helper();
        }, [helper, selected]);
        return selected;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a correlated string co-write that reaches reader work", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Status({ payload }) {
        const [anchor, setAnchor] = useState(null);
        const [rangeEnd, setRangeEnd] = useState(null);
        const [status, setStatus] = useState("idle");
        const setRange = (nextValue) => {
          setAnchor(nextValue);
          setRangeEnd(nextValue);
        };
        useEffect(() => { setRange(payload); }, [payload, setRange]);
        useEffect(() => {
          if (anchor === "ready" && rangeEnd === "ready") setStatus("ready");
        }, [anchor, rangeEnd]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a correlated co-write whose equality guard is reachable for NaN", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Status({ source }) {
        const [anchor, setAnchor] = useState(null);
        const [rangeEnd, setRangeEnd] = useState(null);
        const [status, setStatus] = useState("idle");
        useEffect(() => {
          setAnchor(source);
          setRangeEnd(source);
        }, [source]);
        useEffect(() => {
          if (anchor === rangeEnd) return;
          setStatus(anchor);
        }, [anchor, rangeEnd]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a followed helper write from its direct parameter", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Selection({ source }) {
        const [selected, setSelected] = useState(null);
        const [status, setStatus] = useState("idle");
        const commitSelection = (nextSelection) => {
          setSelected(nextSelection);
        };
        useEffect(() => { commitSelection(source); }, [source, commitSelection]);
        useEffect(() => { if (selected) setStatus("ready"); }, [selected]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a followed helper write from a direct parameter property", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Selection({ source }) {
        const [selected, setSelected] = useState(null);
        const [status, setStatus] = useState("idle");
        const commitSelection = (nextSelection) => {
          setSelected(nextSelection.key);
        };
        useEffect(() => { commitSelection(source); }, [source, commitSelection]);
        useEffect(() => { if (selected) setStatus("ready"); }, [selected]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["direct", "load(active);"],
    ["aliased multi-hop", "const invoke = forward; invoke(active); invoke(active);"],
  ])("follows %s helper arguments through a false guard", (_, invocation) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Loader({ source }) {
        const [active, setActive] = useState(true);
        const [status, setStatus] = useState("idle");
        const load = useCallback((enabled) => {
          if (!enabled) return;
          setStatus("ready");
        }, []);
        const forward = useCallback((enabled) => load(enabled), [load]);
        useEffect(() => { setActive(false); }, [source]);
        useEffect(() => { ${invocation} }, [active, forward, load]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when a forwarded helper argument makes its work reachable", () => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Loader({ source }) {
        const [active, setActive] = useState(false);
        const [status, setStatus] = useState("idle");
        const load = useCallback((enabled) => {
          if (!enabled) return;
          setStatus("ready");
        }, []);
        const forward = useCallback((enabled) => load(enabled), [load]);
        useEffect(() => { setActive(true); }, [source]);
        useEffect(() => { forward(active); }, [active, forward]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an omitted argument", "work();"],
    ["global undefined", "work(undefined);"],
    ["void undefined", "work(void 0);"],
    ["an aliased undefined", "const missing = undefined; work(missing);"],
    ["a wrapped undefined", "work((undefined as undefined));"],
  ])("applies a helper parameter default for %s", (_, invocation) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (flag = true) => {
          if (flag) setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { ${invocation} }, [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a JSX element through a concise effect callback", "<div />", "() => updateTarget()"],
    [
      "a JSX element through an explicit block return",
      "<div />",
      "() => { return updateTarget(); }",
    ],
    ["a JSX fragment through a concise effect callback", "<>content</>", "() => updateTarget()"],
    [
      "a JSX fragment through an explicit block return",
      "<>content</>",
      "() => { return updateTarget(); }",
    ],
  ])("does not mistake %s for cleanup", (_, returnedValue, callback) => {
    const result = runRule(
      noEffectChain,
      `import { useCallback, useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const updateTarget = useCallback(() => {
          setTarget(middle);
          return ${returnedValue};
        }, [middle]);
        useEffect(() => setMiddle(Boolean(source)), [source]);
        useEffect(${callback}, [middle, updateTarget]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a concise ordinary local helper that returns no cleanup", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const setSelection = () => {
          setMiddle(Boolean(source));
        };
        useEffect(() => setSelection(), [setSelection]);
        useEffect(() => setTarget(middle), [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a prop callback",
      `function Widget({ setSelection, source }) {
        const [middle, setMiddle] = useState(null);
        useEffect(() => setMiddle(source), [source]);
        useEffect(() => setSelection(middle), [middle, setSelection]);
        return null;
      }`,
    ],
    [
      "a context callback",
      `function Widget({ source }) {
        const [middle, setMiddle] = useState(null);
        const { setSelection } = useSelectionContext();
        useEffect(() => setMiddle(source), [source]);
        useEffect(() => setSelection(middle), [middle, setSelection]);
        return null;
      }`,
    ],
  ])("keeps a concise opaque setter-like call quiet for %s", (_, source) => {
    const result = runRule(noEffectChain, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves a cleanup returned through a concise ordinary local helper", () => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ consume, source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const updateMiddle = () => {
          setMiddle(Boolean(source));
          return () => consume();
        };
        useEffect(() => updateMiddle(), [updateMiddle]);
        useEffect(() => setTarget(middle), [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["an omitted argument", "work();"],
    ["an explicit undefined", "work(undefined);"],
  ])("treats %s as undefined for an ordinary helper parameter", (_, invocation) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (flag) => {
          if (flag === undefined) return;
          setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { ${invocation} }, [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["an unknown prop", "enabled"],
    ["a value supplied through a NaN-named prop", "notANumber"],
  ])("keeps %s conservative instead of applying a helper parameter default", (_, argument) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ enabled, NaN: notANumber, source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (flag = true) => {
          if (flag) setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { work(${argument}); }, [${argument}, middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["false", "false"],
    ["zero", "0"],
  ])("does not apply a %s default to an unknown helper argument", (_, defaultValue) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ enabled, source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (flag = ${defaultValue}) => {
          if (flag) setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { work(enabled); }, [enabled, middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["null", "null"],
    ["false", "false"],
    ["zero", "0"],
    ["NaN", "NaN"],
  ])("does not apply a helper parameter default to %s", (_, argument) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (flag = true) => {
          if (flag) setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { work(${argument}); }, [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a truthy guard",
      parameters: "first, second",
      parameterRead: "void first;",
      helperBody: "if (second) return; setTarget(middle);",
      trailingArgument: "true",
    },
    {
      name: "a falsy guard",
      parameters: "first, second",
      parameterRead: "void first;",
      helperBody: "if (!second) return; setTarget(middle);",
      trailingArgument: "false",
    },
    {
      name: "a destructured first parameter",
      parameters: "{ value }, second",
      parameterRead: "void value;",
      helperBody: "if (second) return; setTarget(middle);",
      trailingArgument: "true",
    },
  ])("stops positional helper argument mapping after a spread before $name", (fixture) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ flags, source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (${fixture.parameters}) => {
          ${fixture.parameterRead}
          ${fixture.helperBody}
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { work(...flags, ${fixture.trailingArgument}); }, [flags, middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["true", 1],
    ["false", 0],
  ])("resolves a default from an earlier helper parameter set to %s", (argument, count) => {
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Widget({ source }) {
        const [middle, setMiddle] = useState(false);
        const [target, setTarget] = useState(false);
        const work = (first, second = first) => {
          if (second) setTarget(middle);
        };
        useEffect(() => setMiddle(true), [source]);
        useEffect(() => { work(${argument}); }, [middle]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it("keeps colliding helper parameter values as distinct analysis frames", () => {
    const placeholderSource = buildReaderFrameCollisionFixture(
      "placeholder",
      'performWork("x", "y"); performWork("placeholder");',
    );
    const secondParameterSymbolId = getFixtureBindingSymbolId(placeholderSource, "secondValue");
    const collisionValue = `x|${secondParameterSymbolId}:string:y`;
    const result = runRule(
      noEffectChain,
      buildReaderFrameCollisionFixture(
        collisionValue,
        `performWork("x", "y"); performWork(${JSON.stringify(collisionValue)});`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when distinct helper parameter frames both exit before work", () => {
    const result = runRule(
      noEffectChain,
      `function Widget({ source }) {
        const [intermediate, setIntermediate] = useState(false);
        const [target, setTarget] = useState(false);
        const performWork = (value) => {
          if (value === "first" || value === "second") return;
          setTarget(intermediate);
        };
        useEffect(() => setIntermediate(true), [source]);
        useEffect(() => { performWork("first"); performWork("second"); }, [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("handles a deep helper chain without recursive traversal", () => {
    const helperCount = 8_000;
    const helperDeclarations = Array.from({ length: helperCount }, (_, helperIndex) => {
      if (helperIndex === 0) {
        return `const helper0 = (enabled) => { if (!enabled) return; setStatus("ready"); };`;
      }
      return `const helper${helperIndex} = (enabled) => helper${helperIndex - 1}(enabled);`;
    }).join("\n");
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      function Loader({ source }) {
        const [active, setActive] = useState(true);
        const [status, setStatus] = useState("idle");
        ${helperDeclarations}
        useEffect(() => { setActive(false); }, [source]);
        useEffect(() => { helper${helperCount - 1}(active); }, [active]);
        return status;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("handles a deep immutable browser namespace alias chain without recursion", () => {
    const aliasCount = 24_000;
    const aliasDeclarations = Array.from({ length: aliasCount }, (_, aliasIndex) => {
      if (aliasIndex === 0) return `const storageAlias0 = localStorage;`;
      return `const storageAlias${aliasIndex} = storageAlias${aliasIndex - 1};`;
    }).join("\n");
    const result = runRule(
      noEffectChain,
      `import { useEffect, useState } from "react";
      ${aliasDeclarations}
      function PersistedValue({ source }) {
        const [intermediate, setIntermediate] = useState(source);
        const [target, setTarget] = useState(source);
        useEffect(() => {
          setIntermediate(source);
          storageAlias${aliasCount - 1}.setItem("source", String(source));
        }, [source]);
        useEffect(() => { setTarget(intermediate); }, [intermediate]);
        return target;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
