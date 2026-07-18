import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

// Must-detect anchors distilled from mined real-world bug shapes (the
// 0.5.7 -> 0.5.8 regression review). The traps here are proportionality
// mistakes in the externally-driven-state classification: one setter call
// inside a setTimeout, a plain `{ onX: handler }` options-object property, or
// an async function must NOT mark the whole state externally driven when a
// render-path setter call site also exists.

const expectFiresAtLeast = (code: string, minimumDiagnosticCount: number): void => {
  const result = runRule(noChainStateUpdates, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(minimumDiagnosticCount);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.message).toContain("Chaining state updates");
  }
};

describe("no-chain-state-updates — must-detect regressions", () => {
  it("reports a state update through an immutable setter alias", () => {
    expectFiresAtLeast(
      `import { useEffect, useState } from "react";
      const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        const writeReady = setReady;
        const onChange = () => setStep((value) => value + 1);
        useEffect(() => writeReady(true), [step, source]);
        return <button onClick={onChange}>{String(ready)}</button>;
      };`,
      1,
    );
  });
  it("fires on validate-then-submit effect chains when one setter call site sits in a setTimeout (latitude Form)", () => {
    expectFiresAtLeast(
      `
      const Form = ({ initialValues, initialErrors, onSubmit }) => {
        const [state, setState] = useState({
          values: initialValues,
          errors: initialErrors ?? {},
          namesToValidate: null,
          submitStatus: 'READY',
        });
        const lastFocusedFieldName = useRef(null);
        const isMountedRef = useRef(true);

        const onBlur = (event) => {
          const parentName = event.target.name;

          setTimeout(() => {
            if (isMountedRef.current && parentName !== lastFocusedFieldName.current) {
              setState((currentState) => setPath(currentState, 'namesToValidate', [parentName]));
            }
          });
        };

        useEffect(() => {
          if (state.namesToValidate === null) {
            return;
          }

          setState((currentState) => {
            let newState = setPath(currentState, 'errors', getNewErrors(currentState));

            if (currentState.submitStatus === 'VALIDATE_THEN_SUBMIT') {
              newState = setPath(newState, 'submitStatus', 'SUBMIT');
            }

            return newState;
          });
        }, [state.namesToValidate]);

        useEffect(() => {
          if (state.submitStatus === 'SUBMIT') {
            onSubmit && onSubmit({ errors: state.errors, values: state.values });

            setState((currentState) => setPath(currentState, 'submitStatus', 'READY'));
          }
        }, [state.submitStatus, state.errors, state.values, onSubmit]);

        return <FormProvider value={state} onBlur={onBlur} />;
      };
      `,
      2,
    );
  });

  it("fires on an editor-creation chain despite on*-named options-object properties (wangeditor EditorComponent)", () => {
    expectFiresAtLeast(
      `
      function EditorComponent(props: Partial<IProps>) {
        const { defaultContent = [], onCreated, value = '', onChange, defaultConfig = {}, mode = 'default' } = props;
        const ref = useRef<HTMLDivElement | null>(null);
        const latestHtmlRef = useRef('');
        const [editor, setEditor] = useState(null);

        const handleCreated = useCallback((createdEditor) => {
          if (onCreated) { onCreated(createdEditor) }
        }, [onCreated]);

        const handleDestroyed = useCallback((destroyedEditor) => {
          const { onDestroyed } = defaultConfig;

          setEditor(null);
          if (onDestroyed) {
            onDestroyed(destroyedEditor);
          }
        }, [defaultConfig]);

        useEffect(() => {
          if (ref.current == null) { return }
          if (editor != null) { return }
          if (ref.current?.getAttribute('data-w-e-textarea')) { return }

          const newEditor = createEditor({
            selector: ref.current,
            config: {
              ...defaultConfig,
              onCreated: handleCreated,
              onDestroyed: handleDestroyed,
            },
            content: defaultContent,
            html: value,
            mode,
          });

          latestHtmlRef.current = newEditor.getHtml();
          setEditor(newEditor);
        }, [editor, defaultConfig, defaultContent, handleCreated, handleDestroyed, mode, value]);

        return <div ref={ref} />;
      }
      `,
      1,
    );
  });

  it("fires when the triggering state's setter also runs in a plain async handler", () => {
    expectFiresAtLeast(
      `const Uploader = () => {
        const [file, setFile] = useState(null);
        const [status, setStatus] = useState('idle');

        const handleUpload = async (input) => {
          const uploaded = await upload(input);
          setFile(uploaded);
        };

        useEffect(() => {
          if (file === null) return;
          setStatus('done');
        }, [file]);

        return <input onChange={(event) => handleUpload(event.target)} />;
      };`,
      1,
    );
  });

  it("stays silent when every triggering state dep is set only from a setInterval callback", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Clock = () => {
        const [now, setNow] = useState(Date.now());
        const [late, setLate] = useState(false);
        useEffect(() => {
          const id = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(id);
        }, []);
        useEffect(() => {
          if (now % 2 === 0) setLate(true);
        }, [now]);
        return <div>{now}{late ? '!' : ''}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-chain-state-updates — regressions", () => {
  it("stays silent when a setter is passed to a helper factory", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Example = ({ source }) => {
        const [step, setStep] = useState(0);
        const [ready, setReady] = useState(false);
        const bind = (setter) => (value) => setter(value);
        const run = bind(setReady);
        const onChange = () => setStep((value) => value + 1);
        useEffect(() => run(true), [step, source, run]);
        return <button onClick={onChange}>{String(ready)}</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an effect passes a setter through a parameter-bound helper", () => {
    const result = runRule(
      noChainStateUpdates,
      `const useForwardedSetter = (invoke) => {
  const [value, setValue] = useState(0);
  useEffect(() => invoke(setValue), []);
  return value;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on mixed-origin state (handler setter plus one setTimeout site — basis form)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Search = () => {
        const [query, setQuery] = useState("");
        const [highlighted, setHighlighted] = useState(-1);
        const clearLater = () => {
          setTimeout(() => setQuery(""), 5000);
        };
        const onChange = (event) => setQuery(event.target.value);
        useEffect(() => {
          setHighlighted(-1);
        }, [query]);
        return <input onChange={onChange} onBlur={clearLater} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the setter is also wired through an onX config-object property (wangeditor)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function Editor({ defaultContent }) {
        const [editor, setEditor] = useState(null);
        const handleDestroyed = useCallback(() => {
          setEditor(null);
        }, []);
        useEffect(() => {
          if (editor != null) return;
          const newEditor = createEditor({ onDestroyed: handleDestroyed });
          setEditor(newEditor);
        }, [editor]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the state is also set from an async event handler (react-sounds)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Form = () => {
        const [saved, setSaved] = useState(false);
        const [toast, setToast] = useState("");
        const handleSubmit = async () => {
          await api.save();
          setSaved(true);
        };
        useEffect(() => {
          if (saved) setToast("Saved!");
        }, [saved]);
        return <button onClick={handleSubmit}>save</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the chained setter runs through an async useCallback handler", () => {
    const result = runRule(
      noChainStateUpdates,
      `function useSound(src) {
        const [isPlaying, setIsPlaying] = useState(false);
        const [status, setStatus] = useState("idle");
        const play = useCallback(async () => {
          await loadSound(src);
          setIsPlaying(true);
        }, [src]);
        const stop = useCallback(() => {
          setIsPlaying(false);
        }, []);
        useEffect(() => {
          setStatus("changed");
        }, [isPlaying]);
        return { play, stop };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when every triggering state dep is exclusively interval-driven", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Clock = () => {
        const [now, setNow] = useState(Date.now());
        const [late, setLate] = useState(false);
        useEffect(() => {
          const id = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(id);
        }, []);
        useEffect(() => {
          if (now % 2 === 0) setLate(true);
        }, [now]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Guarded self-sync exemption (prod telemetry review 2026-07): effects
  // that react to a state AND write that same state back with a simple
  // re-derivation are clamp/normalize/latch patterns, not chains — the
  // write converges in one pass and has no event handler to move into.
  it("does not flag a clamp effect that re-derives its own state dep with Math builtins (PDFThumbnails)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const PDFThumbnails = ({ currentPage, numPages }) => {
        const [visibleRange, setVisibleRange] = useState({ start: 1, end: 10 });
        useEffect(() => {
          if (currentPage < visibleRange.start) {
            setVisibleRange({
              start: Math.max(1, currentPage - 2),
              end: Math.min(numPages, currentPage + 7),
            });
          }
        }, [currentPage, numPages, visibleRange]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a controlled-prop sync effect that mirrors the prop into its own state dep (brainly Checkbox)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Checkbox = ({ checked, defaultChecked }) => {
        const isControlled = checked !== undefined;
        const [isChecked, setIsChecked] = useState(isControlled ? checked : defaultChecked);
        useEffect(() => {
          if (isControlled && checked !== isChecked) {
            setIsChecked(checked);
          }
        }, [checked, isControlled, isChecked]);
        return <input type="checkbox" checked={isChecked} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a latch effect that flips its own boolean state dep to a literal (brainly RadioGroup)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const RadioGroup = ({ value }) => {
        const initialValue = value;
        const [selectedValue, setSelectedValue] = useState(value || null);
        const [isPristine, setIsPristine] = useState(true);
        useEffect(() => {
          if (selectedValue !== initialValue && isPristine) setIsPristine(false);
        }, [selectedValue, initialValue, isPristine]);
        const updateValue = (event, next) => setSelectedValue(next);
        return updateValue;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Self-targeting setters fed by a non-builtin call result still chain —
  // they create an external instance in the effect (wangeditor shape,
  // anchored above) rather than re-deriving from in-scope values.
  it("still fires when a self-targeting setter's argument comes from a local call result", () => {
    const result = runRule(
      noChainStateUpdates,
      `function Editor() {
        const [editor, setEditor] = useState(null);
        useEffect(() => {
          if (editor != null) return;
          const newEditor = createEditor({ selector: "#editor" });
          setEditor(newEditor);
        }, [editor]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the triggering state is set only inside a .then continuation", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const List = ({ url }) => {
        const [data, setData] = useState(null);
        const [page, setPage] = useState(1);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then((json) => setData(json));
        }, [url]);
        useEffect(() => {
          setPage(1);
        }, [data]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// docs-validation FP wave (3 TP / 6 FP): effects that must read the live DOM
// (querySelector results, post-commit measurements) before setting state —
// the handler cannot compute those values, so the doc's "set both in the
// handler" fix does not apply. Async continuation setters are excluded per
// the doc's "synchronously calls" scoping.
describe("no-chain-state-updates — docs-validation FP wave", () => {
  it("stays silent on anchors resolved via document.querySelectorAll, including the catch-arm reset (react-tooltip)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function Tooltip({ id, anchorSelect }) {
        const [imperativeOptions, setImperativeOptions] = useState(null);
        const [anchorsBySelect, setAnchorsBySelect] = useState([]);
        useEffect(() => {
          let selector = imperativeOptions?.anchorSelect ?? anchorSelect;
          if (!selector && id) {
            selector = "[data-tooltip-id='" + id + "']";
          }
          if (!selector) {
            return;
          }
          try {
            const anchors = Array.from(document.querySelectorAll(selector));
            setAnchorsBySelect(anchors);
          } catch {
            setAnchorsBySelect([]);
          }
        }, [id, anchorSelect, imperativeOptions]);
        return <div data-count={anchorsBySelect.length} onClick={() => setImperativeOptions({ anchorSelect: ".x" })} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a post-commit scrollWidth measurement (react-data-table TableCol)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function TableCol({ column }) {
        const [showTooltip, setShowTooltip] = React.useState(false);
        const columnRef = React.useRef(null);
        React.useEffect(() => {
          if (columnRef.current) {
            setShowTooltip(columnRef.current.scrollWidth > columnRef.current.clientWidth);
          }
        }, [showTooltip]);
        return <div ref={columnRef} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on focus bookkeeping that inspects live DOM attributes (rad-ui RovingFocusGroup)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function RovingFocusGroup() {
        const [focusItems, setFocusItems] = useState([]);
        const [focusedItemId, setFocusedItemId] = useState(null);
        const itemRefsMap = useRef(new Map());
        const findFirstEnabledItemId = useCallback((items) => {
          for (const id of items) {
            const ref = itemRefsMap.current.get(id);
            if (ref?.current?.getAttribute('data-child-disabled') !== 'true') return id;
          }
          return null;
        }, []);
        useEffect(() => {
          if (focusItems.length === 0) {
            if (focusedItemId !== null) {
              setFocusedItemId(null);
            }
            return;
          }
          const focusedItemRef = focusedItemId ? itemRefsMap.current.get(focusedItemId) : null;
          const focusedItemIsEnabled = focusedItemId != null
            && focusedItemRef?.current?.getAttribute('data-child-disabled') !== 'true';
          if (!focusedItemIsEnabled) {
            const firstEnabledItemId = findFirstEnabledItemId(focusItems);
            if (firstEnabledItemId !== focusedItemId) {
              setFocusedItemId(firstEnabledItemId);
            }
          }
        }, [findFirstEnabledItemId, focusItems, focusedItemId]);
        return <div data-focused={focusedItemId} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a deferred confirm flow re-armed by the effect (jaeger DetailTableDropdown)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function DetailTableDropdown({ selectedKeys, setSelectedKeys, confirm }) {
        const confirmedSelectionRef = useRef(selectedKeys);
        const [isCancelled, setIsCancelled] = useState(false);
        const prevSelectedKeysRef = useRef([]);
        useEffect(() => {
          const prevKeys = prevSelectedKeysRef.current;
          if (prevKeys && selectedKeys.length === prevKeys.length) {
            confirmedSelectionRef.current = selectedKeys;
          }
          prevSelectedKeysRef.current = selectedKeys;
          if (isCancelled) {
            confirm();
            setIsCancelled(false);
          }
        }, [selectedKeys, isCancelled, confirm]);
        const cancel = useCallback(() => {
          setSelectedKeys(confirmedSelectionRef.current);
          setIsCancelled(true);
        }, [setSelectedKeys]);
        return <button onClick={cancel} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a setter fired only inside an async fetch continuation (hightable SelectionProvider)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function SelectionProvider({ dataFrameMethods, numRows, onError }) {
        const [selection, setSelection] = useState(null);
        const [allRowsSelected, setAllRowsSelected] = useState(false);
        useEffect(() => {
          if (!selection) return undefined;
          const gesture = startGesture();
          const { signal } = gesture.controller;
          fetchAreAllSelected({ dataFrameMethods, numRows, selection, signal })
            .then((areAllSelected) => { setAllRowsSelected(areAllSelected); })
            .catch((error) => {
              onError?.(error);
            });
        }, [selection, dataFrameMethods, numRows, onError]);
        return <div data-all={allRowsSelected} onClick={() => setSelection({ ranges: [] })} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-chain-state-updates — dependency-to-setter causality", () => {
  it("stays silent when a stable callback dependency only writes state", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useCallback, useEffect, useRef, useState } from "react";

export const Settings = ({ apiKeys }) => {
  const [serverKeys, setServerKeys] = useState(apiKeys);
  const [localKeys, setLocalKeys] = useState(new Map());
  const localKeysRef = useRef(localKeys);

  const commitLocalKeys = useCallback((next) => {
    localKeysRef.current = next;
    setLocalKeys(next);
  }, []);

  useEffect(() => {
    const nextServerKeys = apiKeys.map((key) => key);
    setServerKeys(nextServerKeys);
    if (localKeysRef.current.size > 0) {
      commitLocalKeys(new Map());
    }
  }, [apiKeys, commitLocalKeys]);

  return <output>{serverKeys.length + localKeys.size}</output>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the equivalent inline setter", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";

export const Settings = ({ apiKeys }) => {
  const [serverKeys, setServerKeys] = useState(apiKeys);
  const [localKeys, setLocalKeys] = useState(new Map());
  const localKeysRef = useRef(localKeys);

  useEffect(() => {
    const nextServerKeys = apiKeys.map((key) => key);
    setServerKeys(nextServerKeys);
    if (localKeysRef.current.size > 0) {
      const nextLocalKeys = new Map();
      localKeysRef.current = nextLocalKeys;
      setLocalKeys(nextLocalKeys);
    }
  }, [apiKeys]);

  return <output>{serverKeys.length + localKeys.size}</output>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a distinct state update triggered by live state", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useState } from "react";

export const Search = () => {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (query) setStatus("ready");
  }, [query]);

  return <button onClick={() => setQuery("next")}>{status}</button>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a callback dependency changes with live state", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useCallback, useEffect, useState } from "react";

export const Search = () => {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const trackQuery = useCallback(() => query.length, [query]);

  useEffect(() => {
    trackQuery();
    setStatus("ready");
  }, [trackQuery]);

  return <button onClick={() => setQuery("next")}>{status}</button>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a const alias of a stable callback",
      source: `import { useCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value }) => {
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        const commitAlias = commitLabel;
        useEffect(() => commitAlias(value), [commitAlias, value]);
        return <output>{label}</output>;
      };`,
    },
    {
      name: "a multi-hop alias of a stable callback",
      source: `import { useCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value }) => {
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        const firstAlias = commitLabel;
        const secondAlias = firstAlias;
        useEffect(() => secondAlias(value), [secondAlias, value]);
        return <output>{label}</output>;
      };`,
    },
    {
      name: "a namespace useCallback dependency",
      source: `import * as React from "react";
      const Panel = ({ value }) => {
        const [label, setLabel] = React.useState("");
        const labelRef = React.useRef(label);
        const commitLabel = React.useCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        React.useEffect(() => commitLabel(value), [commitLabel, value]);
        return <output>{label}</output>;
      };`,
    },
    {
      name: "a renamed React useCallback dependency through a TypeScript wrapper",
      source: `import { useCallback as useStableCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value }) => {
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useStableCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        const wrappedCommit = commitLabel satisfies typeof commitLabel;
        useEffect(() => wrappedCommit(value), [wrappedCommit, value]);
        return <output>{label}</output>;
      };`,
    },
    {
      name: "a callback depending only on a stable state setter",
      source: `import { useCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value }) => {
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); }, [setLabel]);
        useEffect(() => commitLabel(value), [commitLabel, value]);
        return <output>{label}</output>;
      };`,
    },
    {
      name: "an opaque imported helper dependency",
      source: `import { commitLabel } from "./label-store";
      const Panel = ({ value }) => {
        const [label] = useState("");
        useEffect(() => commitLabel(value), [commitLabel, value]);
        return <output>{label}</output>;
      };`,
    },
  ])("stays silent for $name", ({ source }) => {
    const result = runRule(noChainStateUpdates, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a direct state dependency alongside a setter-only callback", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = () => {
        const [query, setQuery] = useState("");
        const [status, setStatus] = useState("idle");
        const persistStatus = useCallback((next) => saveStatus(next), []);
        useEffect(() => {
          persistStatus(query);
          setStatus("ready");
        }, [query, persistStatus]);
        return <button onClick={() => setQuery("next")}>{status}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a local function dependency with fresh identity",
      source: `const Panel = ({ value }) => {
        const [serverValue, setServerValue] = useState(value);
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = (next) => { labelRef.current = next; setLabel(next); };
        useEffect(() => { setServerValue(value); commitLabel(value); }, [commitLabel, value]);
        return <output>{serverValue}:{label}</output>;
      };`,
    },
    {
      name: "a reassigned callback dependency",
      source: `const Panel = ({ value, replacement }) => {
        const [serverValue, setServerValue] = useState(value);
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const stableCommit = useCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        let commitLabel = stableCommit;
        commitLabel = replacement ?? commitLabel;
        useEffect(() => { setServerValue(value); commitLabel(value); }, [commitLabel, value]);
        return <output>{serverValue}:{label}</output>;
      };`,
    },
    {
      name: "React useCallback with a missing dependency list",
      source: `import { useCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value }) => {
        const [serverValue, setServerValue] = useState(value);
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); });
        useEffect(() => { setServerValue(value); commitLabel(value); }, [commitLabel, value]);
        return <output>{serverValue}:{label}</output>;
      };`,
    },
    {
      name: "React useCallback with a dynamic dependency list",
      source: `import { useCallback, useEffect, useRef, useState } from "react";
      const Panel = ({ value, dependencies }) => {
        const [serverValue, setServerValue] = useState(value);
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); }, dependencies);
        useEffect(() => { setServerValue(value); commitLabel(value); }, [commitLabel, value]);
        return <output>{serverValue}:{label}</output>;
      };`,
    },
    {
      name: "a custom memoizer whose dependency list reads state",
      source: `const Panel = () => {
        const [query, setQuery] = useState("");
        const [status, setStatus] = useState("idle");
        const trackQuery = customMemo(() => query.length, [query]);
        useEffect(() => { trackQuery(); setStatus("ready"); }, [trackQuery]);
        return <button onClick={() => setQuery("next")}>{status}</button>;
      };`,
    },
    {
      name: "an object-property callback dependency with unknown ownership",
      source: `const Panel = ({ value }) => {
        const [serverValue, setServerValue] = useState(value);
        const [label, setLabel] = useState("");
        const labelRef = useRef(label);
        const commitLabel = useCallback((next) => { labelRef.current = next; setLabel(next); }, []);
        const callbacks = { commitLabel };
        useEffect(() => { setServerValue(value); callbacks.commitLabel(value); }, [callbacks.commitLabel, value]);
        return <output>{serverValue}:{label}</output>;
      };`,
    },
  ])("keeps the conservative finding for $name", ({ source }) => {
    const result = runRule(noChainStateUpdates, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps callback identity state when the callback body also writes state", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useCallback, useEffect, useState } from "react";
      const Panel = () => {
        const [query, setQuery] = useState("");
        const [status, setStatus] = useState("idle");
        const [phase, setPhase] = useState("idle");
        const updateStatus = useCallback(() => setStatus("ready"), [query]);
        useEffect(() => {
          updateStatus();
          setPhase("synced");
        }, [updateStatus]);
        return <button onClick={() => setQuery("next")}>{status}:{phase}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when state-only reruns cannot pass prop snapshot guards", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";

export const GuardedCalendar = ({ defaultsRevision, timezone }: { defaultsRevision: string; timezone: string }) => {
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("");
  const previousDefaultsRevisionRef = useRef(defaultsRevision);
  const previousTimezoneRef = useRef(timezone);

  useEffect(() => {
    const didDefaultsChange = previousDefaultsRevisionRef.current !== defaultsRevision;
    const didTimezoneChange = previousTimezoneRef.current !== timezone;
    previousDefaultsRevisionRef.current = defaultsRevision;
    previousTimezoneRef.current = timezone;

    if (didDefaultsChange) {
      setDateText(String(defaultsRevision));
      setTimeText(timezone);
      return;
    }

    if (!didTimezoneChange) return;
    setDateText(String(selectedRevision));
    setTimeText(timezone);
  }, [defaultsRevision, selectedRevision, timezone]);

  return <button onClick={() => setSelectedRevision((value) => value + 1)}>{dateText}:{timeText}</button>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when changing state reaches a distinct-state setter", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useState } from "react";

export const Search = () => {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(-1);

  useEffect(() => {
    setHighlighted(-1);
  }, [query]);

  return <input value={query} onChange={(event) => setQuery(event.target.value)} data-highlighted={highlighted} />;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for tuple snapshot comparisons and a disjunctive change alias", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Calendar = ({ defaultStartKey, defaultEndKey }: { defaultStartKey: string; defaultEndKey: string }) => {
        const [selectedRevision, setSelectedRevision] = useState(0);
        const [label, setLabel] = useState("");
        const previousDefaultsRef = useRef([defaultStartKey, defaultEndKey]);
        useEffect(() => {
          const [previousStartKey, previousEndKey] = previousDefaultsRef.current;
          const didDefaultsChange = previousStartKey !== defaultStartKey || previousEndKey !== defaultEndKey;
          previousDefaultsRef.current = [defaultStartKey, defaultEndKey];
          if (!didDefaultsChange) return;
          setLabel("reset");
        }, [defaultEndKey, defaultStartKey, selectedRevision]);
        return <button onClick={() => setSelectedRevision((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an exact synchronous predicate proves the prop snapshot unchanged", () => {
    const result = runRule(
      noChainStateUpdates,
      `const didChange = (previousValue, currentValue) => previousValue !== currentValue;
      const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = didChange(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (revisionChanged && selection >= 0) setLabel("reset");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when equality with the prop snapshot exits before the setter", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionIsUnchanged = previousRevisionRef.current === revision;
          previousRevisionRef.current = revision;
          if (revisionIsUnchanged) return;
          setLabel("reset");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent through nested blocks and a known short-circuit return", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision, enabled }: { revision: string; enabled: boolean }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          {
            if (!revisionChanged || !enabled) return;
            setLabel("reset");
          }
        }, [enabled, revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an if-else setter branch requires a changed prop snapshot", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (revisionChanged) {
            setLabel("reset");
          } else {
            recordStableRevision();
          }
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when the snapshot tracks the changing state itself", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Search = () => {
        const [query, setQuery] = useState("");
        const [label, setLabel] = useState("");
        const previousQueryRef = useRef(query);
        useEffect(() => {
          const queryChanged = previousQueryRef.current !== query;
          previousQueryRef.current = query;
          if (queryChanged) setLabel("changed");
        }, [query]);
        return <input value={query} onChange={(event) => setQuery(event.target.value)} data-label={label} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a mutable prop guard can already be true on a state rerun", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ enabled }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        useEffect(() => {
          if (enabled) setLabel("selected");
        }, [enabled, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a state branch can bypass the unchanged prop snapshot", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (revisionChanged || selection > 0) setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when the snapshot ref is only conditionally advanced", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision, enabled }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          if (enabled) previousRevisionRef.current = revision;
          if (revisionChanged) setLabel("reset");
        }, [enabled, revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when another callback mutates the snapshot ref", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (revisionChanged) setLabel("reset");
        }, [revision, selection]);
        const resetSnapshot = () => { previousRevisionRef.current = -1; };
        return <button onClick={() => { resetSnapshot(); setSelection((value) => value + 1); }}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports across an opaque predicate helper", () => {
    const result = runRule(
      noChainStateUpdates,
      `const didChange = (previousValue, currentValue) => {
        recordComparison(previousValue, currentValue);
        return previousValue !== currentValue;
      };
      const Panel = ({ revision }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = didChange(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (revisionChanged) setLabel("reset");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when an exact-looking predicate helper is reassigned", () => {
    const result = runRule(
      noChainStateUpdates,
      `let didChange = (previousValue, currentValue) => previousValue !== currentValue;
      didChange = readMutablePredicate();
      const Panel = ({ revision }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = didChange(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (revisionChanged) setLabel("reset");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a similarly shaped getter is not a React prop snapshot", () => {
    const result = runRule(
      noChainStateUpdates,
      `const source = { get revision() { return readRevision(); } };
      const Panel = () => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(source.revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== source.revision;
          previousRevisionRef.current = source.revision;
          if (revisionChanged) setLabel("reset");
        }, [selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports after a matching labeled break completes the outer statement", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            if (!revisionChanged) break snapshotGuard;
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a nested label break completes before the setter", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          outerGuard: {
            innerGuard: {
              if (!revisionChanged) break innerGuard;
            }
            setLabel("selected");
          }
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a setter after a matching break in the same labeled block", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            if (!revisionChanged) break snapshotGuard;
            setLabel("selected");
          }
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a setter after a matching labeled continue in the same iteration", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          outerLoop: for (const item of [revision]) {
            if (!revisionChanged) continue outerLoop;
            setLabel(String(item));
          }
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an unreachable matching break is followed by a return", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            if (false) break snapshotGuard;
            if (!revisionChanged) return;
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays conservative when a loop may break to the outer label", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            while (true) {
              if (!revisionChanged) break snapshotGuard;
              return;
            }
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a loop's matching break is in an unreachable branch", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            while (selection < 0) {
              if (false) break snapshotGuard;
            }
            if (!revisionChanged) return;
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays conservative when a switch case may break to the outer label", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            switch (revisionChanged) {
              case false:
                break snapshotGuard;
              default:
                return;
            }
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when finally overrides a matching break with return", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            if (!revisionChanged) {
              try {
                break snapshotGuard;
              } finally {
                return;
              }
            }
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when a typed alias reads a mutable nested prop", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ config }: { config: { revision: string } }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const revision: string = config.revision;
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => { config.revision = "next"; setSelection((value) => value + 1); }}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports for nested destructured prop bindings", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ config: { revision } }: { config: { revision: string } }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports for rest prop bindings", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ ignored, ...remainingProps }: { ignored: boolean; revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousPropsRef = useRef(remainingProps);
        useEffect(() => {
          const propsChanged = previousPropsRef.current !== remainingProps;
          previousPropsRef.current = remainingProps;
          if (!propsChanged) return;
          setLabel(remainingProps.revision);
        }, [remainingProps, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports for nondeterministic destructured defaults", () => {
    const result = runRule(
      noChainStateUpdates,
      `let nextRevision = 0;
      const Panel = ({ revision = String(nextRevision++) }: { revision?: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports for call-based destructured defaults", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision = String(Math.random()) }: { revision?: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for stable primitive destructured defaults", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision = "initial" }: { revision?: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports for custom hook parameters with dynamic callers", () => {
    const result = runRule(
      noChainStateUpdates,
      `const usePanel = (revision: string) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return { label, setSelection };
      };
      const Panel = () => {
        const panel = usePanel(String(Math.random()));
        return <button onClick={() => panel.setSelection((value) => value + 1)}>{panel.label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative for custom hook parameters with stable-looking callers", () => {
    const result = runRule(
      noChainStateUpdates,
      `const usePanel = (revision: string) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return { label, setSelection };
      };
      const Panel = ({ revision }: { revision: string }) => {
        const panel = usePanel(revision);
        return <button onClick={() => panel.setSelection((value) => value + 1)}>{panel.label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for numeric snapshots compared with global Object.is", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = !Object.is(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for unchanged numeric snapshots compared with global Object.is", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionIsUnchanged = Object.is(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (revisionIsUnchanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports for shadowed Object.is comparisons", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: number }) => {
        const Object = { is: () => false };
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = !Object.is(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when global Object.is is overwritten", () => {
    const result = runRule(
      noChainStateUpdates,
      `Object.is = () => false;
      const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = !Object.is(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative for aliases of global Object.is", () => {
    const result = runRule(
      noChainStateUpdates,
      `const isSameValue = Object.is;
      const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = !isSameValue(previousRevisionRef.current, revision);
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel(revision);
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an empty for-of cannot break an outer label", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            for (const item of []) if (!revisionChanged) break snapshotGuard;
            if (!revisionChanged) return;
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an empty for-in cannot break an outer label", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            for (const key in {}) if (!revisionChanged) break snapshotGuard;
            if (!revisionChanged) return;
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an impossible switch case cannot break an outer label", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            switch (true) {
              case false: break snapshotGuard;
              default: return;
            }
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a nonthrowing try cannot reach a catch break", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          snapshotGuard: {
            try { return; } catch { break snapshotGuard; }
          }
          setLabel("selected");
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when a numeric snapshot can be NaN", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState({ revision });
        const previousRevisionRef = useRef(revision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== revision;
          previousRevisionRef.current = revision;
          if (!revisionChanged) return;
          setLabel({ revision });
        }, [revision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label.revision}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when invalid dates produce non-reflexive timestamps", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ date }: { date: Date }) => {
        const [selection, setSelection] = useState(0);
        const [selectedDate, setSelectedDate] = useState(date);
        const timestamp = date.getTime();
        const previousTimestampRef = useRef(timestamp);
        useEffect(() => {
          const timestampChanged = previousTimestampRef.current !== timestamp;
          previousTimestampRef.current = timestamp;
          if (!timestampChanged) return;
          setSelectedDate(new Date(timestamp));
        }, [selection, timestamp]);
        return <button onClick={() => setSelection((value) => value + 1)}>{selectedDate.toString()}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a string coercion makes the snapshot reflexive", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: string | number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState("");
        const revisionKey = String(revision);
        const previousRevisionKeyRef = useRef(revisionKey);
        useEffect(() => {
          const revisionChanged = previousRevisionKeyRef.current !== revisionKey;
          previousRevisionKeyRef.current = revisionKey;
          if (!revisionChanged) return;
          setLabel(revisionKey);
        }, [revisionKey, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when bitwise normalization makes a numeric snapshot reflexive", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Panel = ({ revision }: { revision: number }) => {
        const [selection, setSelection] = useState(0);
        const [label, setLabel] = useState(0);
        const normalizedRevision = revision | 0;
        const previousRevisionRef = useRef(normalizedRevision);
        useEffect(() => {
          const revisionChanged = previousRevisionRef.current !== normalizedRevision;
          previousRevisionRef.current = normalizedRevision;
          if (!revisionChanged) return;
          setLabel(normalizedRevision);
        }, [normalizedRevision, selection]);
        return <button onClick={() => setSelection((value) => value + 1)}>{label}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports state chains through an isomorphic layout effect alias", () => {
    const result = runRule(
      noChainStateUpdates,
      `import * as React from "react";
      const useIsomorphicLayoutEffect =
        typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

      const NavigationTree = () => {
        const [activeId, setActiveId] = React.useState("");
        const [selectedId, setSelectedId] = React.useState("");
        const clearLater = () => setTimeout(() => setActiveId(""), 100);
        const onChange = (event) => setActiveId(event.target.value);
        useIsomorphicLayoutEffect(() => {
          setSelectedId("");
        }, [activeId]);
        return <input value={selectedId} onChange={onChange} onBlur={clearLater} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports the same state chain in a direct layout effect", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useLayoutEffect, useState } from "react";
      const NavigationTree = () => {
        const [activeId, setActiveId] = useState("");
        const [selectedId, setSelectedId] = useState("");
        const clearLater = () => setTimeout(() => setActiveId(""), 100);
        const onChange = (event) => setActiveId(event.target.value);
        useLayoutEffect(() => {
          setSelectedId("");
        }, [activeId]);
        return <input value={selectedId} onChange={onChange} onBlur={clearLater} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when an effect alias can select an opaque hook", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useState } from "react";
      const useMaybeEffect = Math.random() > 0.5 ? useEffect : useCustomEffect;
      const NavigationTree = () => {
        const [activeId, setActiveId] = useState("");
        const [selectedId, setSelectedId] = useState("");
        const clearLater = () => setTimeout(() => setActiveId(""), 100);
        const onChange = (event) => setActiveId(event.target.value);
        useMaybeEffect(() => {
          setSelectedId("");
        }, [activeId]);
        return <input value={selectedId} onChange={onChange} onBlur={clearLater} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
