import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

interface InternxtHelperFixtureOptions {
  helperDeclaration: string;
  helperInvocation: string;
  itemLoader?: string;
}

// Must-detect anchors distilled from mined real-world bug shapes (the
// 0.5.7 -> 0.5.8 regression review). Each fixture keeps the context an
// overbroad FP guard is most likely to key on — useCallback-wrapped parent
// callbacks, async handlers that also call the setter, and guarded /
// discarded call results. Silence a mined FP with a narrower, shape-specific
// guard instead of a whole-scope bailout.

const expectFiresAtLeast = (code: string, minimumDiagnosticCount: number): void => {
  const result = runRule(noPassLiveStateToParent, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(minimumDiagnosticCount);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.message).toContain("Pushing state up to a parent");
  }
};

const expectFiresOnce = (code: string): void => {
  const result = runRule(noPassLiveStateToParent, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.message).toContain("Pushing state up to a parent");
};

const makeInternxtHelperFixture = ({
  helperDeclaration,
  helperInvocation,
  itemLoader = "getMoreTrashItems",
}: InternxtHelperFixtureOptions): string => `
  export const useTrashPagination = ({ getTrashPaginated, setHasMoreItems, isTrash }) => {
    const [hasMoreTrashFolders] = useState(true);

    const getMoreTrashFiles = useCallback(async () => {
      const result = await getTrashPaginated();
      setHasMoreItems(result && !result.finished);
    }, [getTrashPaginated, setHasMoreItems]);

    const getMoreTrashItems = useCallback(() => {
      return hasMoreTrashFolders ? Promise.resolve() : getMoreTrashFiles();
    }, [hasMoreTrashFolders, getMoreTrashFiles]);

    useEffect(() => {
      if (!isTrash) return;
      ${helperDeclaration.replaceAll("ITEM_LOADER", itemLoader)}
      ${helperInvocation}
    }, [isTrash, getMoreTrashItems]);

    return { hasMoreTrashFolders };
  };
`;

describe("no-pass-live-state-to-parent — must-detect regressions", () => {
  it("preserves live-state flow through direct React useEffectEvent wrappers", () => {
    expectFiresAtLeast(
      `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState("");
        const notify = useEffectEvent(onChange);
        useEffect(() => {
          notify(value);
        }, [value]);
        return null;
      };`,
      1,
    );
  });

  it("does not trust a userland useEffectEvent wrapper", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const useEffectEvent = (callback) => callback;
      const Child = ({ onChange }) => {
        const [value] = useState("");
        const notify = useEffectEvent(onChange);
        useEffect(() => notify(value), [value]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a callback parameter is passed through a parent callback", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const useForwarder = (onRegister, callback) => {
  useEffect(() => {
    onRegister(callback);
  }, [onRegister, callback]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on onError(error) in an effect when the setter is also called in async handlers (inrupt Image)", () => {
    expectFiresAtLeast(
      `
      const Image = ({ thing, property, onError, onSave }: Props) => {
        const values = useProperty({ thing, property, type: 'url' });
        const { value, error: thingError } = values;
        let valueError;
        if (!value) {
          valueError = new Error('No value found for property.');
        }
        const [error, setError] = useState(thingError ?? valueError);

        useEffect(() => {
          if (error) {
            if (onError) {
              onError(error);
            }
          }
        }, [error, onError]);

        const handleChange = async (input) => {
          try {
            await saveImage(input);
            if (onSave) {
              onSave();
            }
          } catch (saveError) {
            setError(saveError);
          }
        };

        return <input onChange={(event) => handleChange(event.target)} />;
      };
      `,
      1,
    );
  });

  it("fires on a discarded useCallback-chain call that forwards state to a parent setter (internxt useTrashPagination)", () => {
    expectFiresAtLeast(
      `
      export const useTrashPagination = ({ getTrashPaginated, filesOnTrashLength, folderOnTrashLength, setHasMoreItems, isTrash, order }) => {
        const [isLoadingTrashItems, setIsLoadingTrashItems] = useState(false);
        const [hasMoreTrashFolders, setHasMoreTrashFolders] = useState(true);

        useEffect(() => {
          const isTrashAndNotHasItems = isTrash;
          if (isTrashAndNotHasItems) {
            getMoreTrashItems().catch((error) => errorService.reportError(error));
          }
        }, []);

        const getMoreTrashFolders = useCallback(async () => {
          setIsLoadingTrashItems(true);
          if (getTrashPaginated) {
            const result = await getTrashPaginated(0, folderOnTrashLength, 'folders');
            setHasMoreTrashFolders(result && !result.finished);
          }
          setIsLoadingTrashItems(false);
        }, [getTrashPaginated, folderOnTrashLength]);

        const getMoreTrashFiles = useCallback(async () => {
          setIsLoadingTrashItems(true);
          if (getTrashPaginated) {
            const result = await getTrashPaginated(0, filesOnTrashLength, 'files');
            setHasMoreItems(result && !result.finished);
          }
          setIsLoadingTrashItems(false);
        }, [getTrashPaginated, filesOnTrashLength, setHasMoreItems]);

        const getMoreTrashItems = useCallback(() => {
          return hasMoreTrashFolders ? getMoreTrashFolders() : getMoreTrashFiles();
        }, [hasMoreTrashFolders, getMoreTrashFolders, getMoreTrashFiles]);

        return { isLoadingTrashItems, hasMoreTrashFolders, getMoreTrashItems };
      };
      `,
      1,
    );
  });

  it.each([
    {
      helperDeclaration: "const fetchInitialTrashItems = () => ITEM_LOADER();",
      helperInvocation: "fetchInitialTrashItems();",
      name: "local synchronous helper",
    },
    {
      helperDeclaration:
        "const fetchInitialTrashItems = async () => { try { await ITEM_LOADER(); } catch (error) { errorService.reportError(error); } };",
      helperInvocation: "void fetchInitialTrashItems();",
      name: "local async helper invoked with void",
    },
    {
      helperDeclaration: "const fetchInitialTrashItems = async () => { await ITEM_LOADER(); };",
      helperInvocation: "fetchInitialTrashItems();",
      name: "local async helper",
    },
    {
      helperDeclaration:
        "const fetchInitialTrashItems = async () => { await ITEM_LOADER(); }; const loadInitialTrashItems = fetchInitialTrashItems;",
      helperInvocation: "void loadInitialTrashItems();",
      name: "immutable local helper alias",
    },
  ])("preserves the Internxt live-state verdict through a $name", (fixture) => {
    expectFiresOnce(makeInternxtHelperFixture(fixture));
  });

  it("stays silent when the local helper does not reach a parent callback", () => {
    const result = runRule(
      noPassLiveStateToParent,
      makeInternxtHelperFixture({
        helperDeclaration: "const fetchInitialTrashItems = async () => { await ITEM_LOADER(); };",
        helperInvocation: "void fetchInitialTrashItems();",
        itemLoader: "getTrashPaginated",
      }),
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow a reassigned local helper alias", () => {
    const result = runRule(
      noPassLiveStateToParent,
      makeInternxtHelperFixture({
        helperDeclaration:
          "const fetchInitialTrashItems = async () => { await ITEM_LOADER(); }; let loadInitialTrashItems = fetchInitialTrashItems; loadInitialTrashItems = async () => {};",
        helperInvocation: "void loadInitialTrashItems();",
      }),
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on onSubmit receiving live form state while another setter runs inside setTimeout (latitude Form)", () => {
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

        const setErrors = useCallback((errorsMap) => {
          setState((currentState) => setPath(currentState, 'errors', errorsMap));
        }, []);

        useEffect(() => {
          if (state.submitStatus === 'SUBMIT') {
            onSubmit &&
              onSubmit({
                errors: state.errors,
                values: state.values,
                setErrors,
              });

            setState((currentState) => setPath(currentState, 'submitStatus', 'READY'));
          }
        }, [state.submitStatus, state.errors, state.values, onSubmit, setErrors]);

        return <FormProvider value={state} onBlur={onBlur} />;
      };
      `,
      1,
    );
  });

  it("fires on a prop-reading autocomplete helper called with state from an effect (octokatherine SectionsColumn)", () => {
    expectFiresAtLeast(
      `
      const SectionsColumn = ({ sectionSlugs, setSectionSlugs, getTemplate }) => {
        const [searchFilter, setSearchFilter] = useState('');
        const [filteredSlugs, setFilteredSlugs] = useState([]);

        const getAutoCompleteResults = (searchQuery) => {
          const suggestedSlugs = sectionSlugs.filter((slug) => {
            return getTemplate(slug).name.toLowerCase().includes(searchQuery.toLowerCase());
          });

          return suggestedSlugs.length ? suggestedSlugs : [undefined];
        };

        const resetSearchFilter = () => setSearchFilter('');

        useEffect(() => {
          if (!searchFilter) {
            setFilteredSlugs([]);
            return;
          }

          const suggestedSlugs = getAutoCompleteResults(searchFilter.trim());

          setFilteredSlugs(suggestedSlugs);
        }, [searchFilter]);

        return <button onClick={resetSearchFilter}>{filteredSlugs.length}</button>;
      };
      `,
      1,
    );
  });

  it("stays silent when the prop is a pure transform whose result feeds a local setter", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ format }) {
        const [amount, setAmount] = useState(0);
        const [display, setDisplay] = useState('');
        useEffect(() => { setDisplay(format(amount)); }, [amount]);
        return <button onClick={() => setAmount(1)}>{display}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags observer-driven state handed to the parent (notify-parent-in-effect)", () => {
    expectFiresAtLeast(
      `const Lazy = ({ onShow }) => {
        const ref = useRef(null);
        const [seen, setSeen] = useState(false);
        useEffect(() => {
          const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) setSeen(true);
          });
          if (ref.current) io.observe(ref.current);
          return () => io.disconnect();
        }, []);
        useEffect(() => {
          if (seen) onShow?.(seen);
        }, [seen]);
        return <div ref={ref} />;
      };`,
      1,
    );
  });

  it("stays silent for functions returned by a state-owning custom hook", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Panel({ initialHash }) {
        const { clearHash } = useSessionHashScroll(initialHash);
        const [section, setSection] = useState('');
        useEffect(() => {
          if (section) clearHash(section);
        }, [section]);
        return <nav onClick={() => setSection('top')} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on onChange callbacks wrapped by a custom hook receiving derived state (react-colorful useColorManipulation)", () => {
    expectFiresAtLeast(
      `
      export function useColorManipulation<T extends AnyColor>(
        colorModel: ColorModel<T>,
        color: T,
        onChange?: (color: T) => void,
        onChangeEnd?: (color: T) => void
      ): [HsvaColor, (color: Partial<HsvaColor>) => void, () => void] {
        const onChangeCallback = useEventCallback<T>(onChange);
        const onChangeEndCallback = useEventCallback<T>(onChangeEnd);

        const [hsva, updateHsva] = useState<HsvaColor>(() => colorModel.toHsva(color));

        const cache = useRef({ color, hsva });
        const isDirty = useRef(false);

        useEffect(() => {
          if (!colorModel.equal(color, cache.current.color)) {
            const newHsva = colorModel.toHsva(color);
            cache.current = { hsva: newHsva, color };
            updateHsva(newHsva);
            isDirty.current = false;
          }
        }, [color, colorModel]);

        useEffect(() => {
          let newColor;
          if (
            !equalColorObjects(hsva, cache.current.hsva) &&
            !colorModel.equal((newColor = colorModel.fromHsva(hsva)), cache.current.color)
          ) {
            cache.current = { hsva, color: newColor };
            onChangeCallback(newColor);
            isDirty.current = true;
          }
        }, [hsva, colorModel, onChangeCallback]);

        const handleChange = useCallback((params: Partial<HsvaColor>) => {
          updateHsva((current) => Object.assign({}, current, params));
        }, []);

        const commitChange = useCallback(() => {
          if (isDirty.current) {
            isDirty.current = false;
            onChangeEndCallback(cache.current.color);
          }
        }, [onChangeEndCallback]);

        return [hsva, handleChange, commitChange];
      }
      `,
      1,
    );
  });
});

describe("no-pass-live-state-to-parent — regressions", () => {
  it("still flags props.search(state) — a parent callback named like String.prototype.search", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = (props) => {
        const [results, setResults] = useState([]);
        useEffect(() => {
          props.search(results);
        }, [props, results]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a parent push whose `props` receiver is wrapped in `as any`", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = (props) => {
        const [results, setResults] = useState([]);
        useEffect(() => {
          (props as any).onResults(results);
        }, [props, results]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a string read from a prop value (text.search)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = ({ text }) => {
        const [pattern] = useState("needle");
        useEffect(() => {
          if (text.search(pattern) >= 0) console.log("found");
        }, [text, pattern]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the prop is a pure transform consumed locally", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ format }) {
        const [amount] = useState(0);
        const [display, setDisplay] = useState("");
        useEffect(() => { setDisplay(format(amount)); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a discarded prop callback that hands state to the parent", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ onSync }) {
        const [amount, setAmount] = useState(0);
        useEffect(() => { onSync(amount); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a concise-arrow effect body handing state up", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ onSync }) {
        const [amount, setAmount] = useState(0);
        useEffect(() => onSync(amount), [amount]);
        return <button onClick={() => setAmount(1)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a logically guarded hand-back (onSubmit && onSubmit(values))", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Form({ onSubmit }) {
        const [values, setValues] = useState({});
        useEffect(() => { onSubmit && onSubmit(values); }, [values]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a useCallback-wrapped prop callback (next-themes shape)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        const notify = useCallback((next) => onChange(next), [onChange]);
        useEffect(() => { notify(value); }, [value, notify]);
        return <input onChange={(event) => setValue(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a block-return setter callback in a discarded effect helper", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Parent = ({ value }) => {
        const Nested = ({ source, setTimeout }) => {
          const [intermediate, setIntermediate] = useState(source);
          const [target, setTarget] = useState(source);
          const derive = useCallback(() => {
            return setTimeout(intermediate);
          }, [intermediate, setTimeout]);
          useEffect(() => {
            setIntermediate(source);
          }, [source]);
          useEffect(() => {
            derive();
            setTarget(intermediate);
          }, [derive, intermediate]);
          return target;
        };
        return <Nested source={value} setTimeout={handle} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a useEventCallback-wrapped prop callback (react-colorful shape)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const useEventCallback = (handler) => useCallback((value) => handler(value), [handler]);
      function useColorManipulation({ color, onChange }) {
        const [hsva, updateHsva] = useState(color);
        const onChangeCallback = useEventCallback(onChange);
        useEffect(() => {
          onChangeCallback(hsva);
        }, [hsva]);
        return [hsva, updateHsva];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a zero-argument completion ping (onEnd())", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Animation({ onEnd }) {
        const [frame, setFrame] = useState(0);
        useEffect(() => {
          if (frame > 10) onEnd();
        }, [frame]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a local lifecycle helper receives state but only pings a parent without data", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Animation({ easing, onEnd }) {
        const [frame, setFrame] = useState({ progress: 0 });
        const timer = useTimer();
        const ease = easingTable[formatName(easing)];
        const traverseQueue = (startFrame) => {
          timer.subscribe(() => setFrame(advance(ease(startFrame.progress))));
          if (isQueueEmpty()) onEnd();
        };
        useEffect(() => {
          traverseQueue(frame);
        }, [frame]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a local helper that forwards state to a parent callback", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Editor({ onChange }) {
        const [value, setValue] = useState("");
        const notifyParent = (nextValue) => onChange(nextValue);
        useEffect(() => {
          notifyParent(value);
        }, [value]);
        return <input onChange={(event) => setValue(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a callback destructured from a whole props object after state setup", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Editor(props) {
        const [value] = useState("");
        const { onChange } = props;
        useEffect(() => {
          onChange(value);
        }, [onChange, value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a callback destructured from a TypeScript-wrapped props object", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `interface EditorProps {
        onChange: (value: string) => void;
      }
      function Editor(props: EditorProps) {
        const [value] = useState("");
        const { onChange } = props as EditorProps;
        useEffect(() => {
          onChange(value);
        }, [onChange, value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a callback aliased from a prop handler bag", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Editor({ handlers }) {
        const [value] = useState("");
        const onChange = handlers.onChange;
        useEffect(() => {
          onChange(value);
        }, [onChange, value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // cloudscape use-app-layout: closeFirstDrawer is a stable callback that
  // calls onActiveDrawerChange — a binding destructured from useDrawers(...)
  // whose ARGUMENTS include state. Hook inputs are not provenance of hook
  // outputs, so no live state reaches the parent.
  it("stays silent when state only enters a custom hook call that produced the invoked callback", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function AppLayout({ onNavigationToggle, ...rest }) {
        const [expandedDrawerId, setExpandedDrawerId] = useState(null);
        const { activeDrawer, drawersOpenQueue, onActiveDrawerChange } = useDrawers({
          ...rest,
          expandedDrawerId,
          setExpandedDrawerId,
        });
        const closeFirstDrawer = useCallback(() => {
          const drawerToClose = drawersOpenQueue.current[drawersOpenQueue.current.length - 1];
          if (activeDrawer && activeDrawer.id === drawerToClose) {
            onActiveDrawerChange(null, { initiatedByUserAction: true });
          }
        }, [activeDrawer, drawersOpenQueue, onActiveDrawerChange]);
        useEffect(() => {
          closeFirstDrawer();
        }, [closeFirstDrawer]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // cloudscape date-range-picker dropdown: isValidRange is a validator prop
  // whose result is captured into a local variable — a pure transform read,
  // not a notification to the parent.
  it("stays silent when the prop call result is captured into a local variable", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Dropdown({ isValidRange, formatValue }) {
        const [applyClicked, setApplyClicked] = useState(false);
        const [selectedRange, setSelectedRange] = useState(null);
        const [validationResult, setValidationResult] = useState(null);
        useEffect(() => {
          if (applyClicked) {
            const formattedRange = formatValue(selectedRange);
            const newValidationResult = isValidRange(formattedRange);
            setValidationResult(newValidationResult);
          }
        }, [applyClicked, selectedRange, isValidRange]);
        return <div>{String(validationResult)}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // appflowy useDocumentLoader: bindViewSync(doc) returns a sync context the
  // effect inspects locally — the prop is a factory, not a notification.
  it("stays silent when a factory prop's captured result gates a local setter", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function useDocumentLoader({ bindViewSync }) {
        const [doc, setDoc] = useState(null);
        const [syncBound, setSyncBound] = useState(false);
        useEffect(() => {
          if (!doc || !bindViewSync || syncBound) return;
          const syncContext = bindViewSync(doc);
          if (syncContext) {
            setSyncBound(true);
          }
        }, [doc, bindViewSync, syncBound]);
        return doc;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // jaeger ServicesView / hyperdx DBRowTable: fetch-named callbacks pull
  // data IN (redux thunks, react-query fetchNextPage) — passing state to
  // them parameterizes a request instead of mirroring state up.
  it("stays silent when state parameterizes fetch-named data-loading callbacks", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function ServicesView({ fetchAllServiceMetrics, fetchNextPage }) {
        const [selectedService, setSelectedService] = useState('all');
        const [selectedTimeFrame, setSelectedTimeFrame] = useState(3600000);
        useEffect(() => {
          fetchAllServiceMetrics({ service: selectedService, timeFrame: selectedTimeFrame });
          fetchNextPage(selectedService);
        }, [selectedService, selectedTimeFrame]);
        return <select onChange={(event) => setSelectedService(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // pwa-kit useAddressFields: react-hook-form's setValue('field', '') is a
  // field-targeting API — a literal first argument hands no state up, so the
  // setter-named heuristic must not fire on it.
  it("stays silent on setter-named form APIs with a literal field argument", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function useAddressFields({ form: { setValue }, resetSession }) {
        const [countryCode, setCountryCode] = useState('US');
        const clearAddressFields = () => {
          setValue('address1', '');
          setValue('city', '');
          resetSession();
        };
        useEffect(() => {
          clearAddressFields();
        }, [countryCode]);
        return countryCode;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // lobe-ui useScrollOverflow: the pushed object is a fresh copy of state
  // ({ ...scrollState }) overwritten with new DOM measurements before being
  // handed both to the local setter and the parent — the parent receives the
  // freshly computed value, not stale live state.
  it("stays silent when a spread-copied state object is recomputed before the hand-off", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function useScrollOverflow({ domRef, onVisibilityChange }) {
        const [scrollState, setScrollState] = useState({ top: false, bottom: false });
        useEffect(() => {
          const element = domRef.current;
          if (!element) return;
          const checkScroll = () => {
            const newState = { ...scrollState };
            newState.top = element.scrollTop > 0;
            newState.bottom = element.scrollTop + element.clientHeight < element.scrollHeight;
            setScrollState(newState);
            onVisibilityChange?.(newState);
          };
          checkScroll();
          element.addEventListener('scroll', checkScroll);
          return () => element.removeEventListener('scroll', checkScroll);
        }, [domRef, onVisibilityChange]);
        return scrollState;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags live state handed to a handler-bag prop method (internxt FileVideoViewer, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const FileVideoViewer = ({ disableVideoStream, handlersForSpecialItems }) => {
        const [canPlay, setCanPlay] = useState(false);
        const [simulatedProgress, setSimulatedProgress] = useState(0);
        useEffect(() => {
          if (!disableVideoStream && !canPlay && simulatedProgress > 0) {
            handlersForSpecialItems?.handleUpdateProgress(simulatedProgress);
          }
        }, [simulatedProgress, canPlay, disableVideoStream, handlersForSpecialItems]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a setter prop is hydrated from localStorage on mount (jaeger LayoutSettings, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const LayoutSettings = ({ density, setDensity }) => {
        useEffect(() => {
          const storedDensity = localStorage.getItem("ddg.layout.density");
          if (storedDensity && storedDensity !== density) {
            setDensity(storedDensity);
          }
        }, [setDensity]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a setter prop is defaulted from async hook data (kubetail KubeContextPicker, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const KubeContextPicker = ({ value, setValue }) => {
        const { data } = useKubeConfig();
        const currentContext = data?.currentContext ?? null;
        useEffect(() => {
          if (value !== null) return;
          if (currentContext) setValue(currentContext);
        }, [value, currentContext, setValue]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a field-targeting form API with a variable field name and literal payload (hyperdx AlertScheduleFields, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function AlertScheduleFields({ setValue, scheduleOffsetName, scheduleOffsetMinutes, maxScheduleOffsetMinutes }) {
        const showScheduleOffsetInput = maxScheduleOffsetMinutes > 0;
        useEffect(() => {
          const normalizedOffset = scheduleOffsetMinutes ?? 0;
          if (!showScheduleOffsetInput && normalizedOffset !== 0) {
            setValue(scheduleOffsetName, 0, { shouldValidate: true });
          }
        }, [scheduleOffsetMinutes, scheduleOffsetName, setValue, showScheduleOffsetInput]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a prop transform's result feeds a DOM write through a conditional (freecut SliderInput, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function SliderInput({ formatValueProp, unit }) {
        const [localValue, setLocalValue] = useState(null);
        const [isInteracting, setIsInteracting] = useState(false);
        const valueSpanRef = useRef(null);
        const localValueRef = useRef(null);
        const formatDisplay = useCallback((v) => {
          if (formatValueProp) return formatValueProp(v);
          return unit ? String(v) + unit : String(v);
        }, [formatValueProp, unit]);
        const updateDisplayedValue = useCallback((nextLocalValue) => {
          localValueRef.current = nextLocalValue;
          if (!valueSpanRef.current) return;
          valueSpanRef.current.textContent =
            nextLocalValue === null ? "Mixed" : formatDisplay(nextLocalValue);
        }, [formatDisplay]);
        useEffect(() => {
          localValueRef.current = localValue;
          if (!isInteracting) {
            updateDisplayedValue(localValue);
          }
        }, [isInteracting, localValue, updateDisplayedValue]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a prop (not state) is registered upward once per value (jaeger VirtualizedTraceView, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function VirtualizedTraceView({ trace, uiFind, setTrace }) {
        const prevTraceRef = useRef(null);
        useEffect(() => {
          if (prevTraceRef.current !== trace) {
            prevTraceRef.current = trace;
            setTrace(trace, uiFind);
          }
        }, [trace, uiFind, setTrace]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an async fetch result is handed to a parent-owned setter prop (freecut clip-waveform, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function ClipWaveform({ mediaId, setBlobUrl }) {
        useEffect(() => {
          let mounted = true;
          const loadBlobUrl = async () => {
            const url = await resolveMediaUrl(mediaId);
            if (mounted && url) {
              setBlobUrl(url);
            }
          };
          loadBlobUrl();
          return () => {
            mounted = false;
          };
        }, [mediaId, setBlobUrl]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a form-library setter destructured from a cast hook call receives validation errors (commercelayer BillingAddressForm, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function BillingAddressForm({ fieldEvent, customFieldMessageError, children }) {
        const { errors, setError: setErrorForm } = (useRapidForm as any)({ fieldEvent });
        useEffect(() => {
          if (customFieldMessageError != null) {
            const customMessage = customFieldMessageError({ field: "name", value: "x" });
            if (typeof customMessage === "string") {
              setErrorForm({ name: "field", code: "VALIDATION_ERROR", message: customMessage });
            }
          }
        });
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an effect only kicks off mutations whose deferred onCompleted hands server data up (glific TranslateButton, delta audit)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `export const TranslateButton = ({ setStates, templateId, saveClicked }) => {
        const [translateOption, setTranslateOption] = useState("translate");
        const [translateInteractiveMessage] = useMutation(TRANSLATE_INTERACTIVE_TEMPLATE, {
          onCompleted: ({ translateInteractiveTemplate }) => {
            setStates(translateInteractiveTemplate.interactiveTemplate);
          },
        });
        const handleTranslateOptions = () => {
          if (translateOption === "translate") {
            translateInteractiveMessage({
              variables: { translateInteractiveTemplateId: templateId },
            });
          }
        };
        useEffect(() => {
          if (templateId && saveClicked) {
            handleTranslateOptions();
          }
        }, [saveClicked, templateId]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags state driven by a frame-callback subscription (victory-animation)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Animation({ onEnd }) {
        const [frame, setFrame] = useState(null);
        useEffect(() => {
          const subscription = timer.subscribe((data) => setFrame(data));
          return () => subscription.unsubscribe();
        }, []);
        useEffect(() => {
          if (frame) onEnd(frame);
        }, [frame]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("no-pass-live-state-to-parent — native parity boundaries", () => {
  it.each([
    {
      name: "live-state-void-transparent-async-data-prop-reader",
      source:
        "import { useCallback, useEffect, useState } from 'react'; export function Child({ accountId }) { const [count] = useState(0); const read = useCallback(async value => { console.log(accountId, value); }, [accountId]); useEffect(() => { void read(count); }, [read, count]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-transparent-async-data-prop-reader",
      source:
        "import { useCallback, useEffect, useState } from 'react'; export function Child({ accountId }) { const [count] = useState(0); const read = useCallback(async value => { console.log(accountId, value); }, [accountId]); useEffect(() => { read(count); }, [read, count]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-void-direct-parent-callback",
      source:
        "import { useEffect, useState } from 'react'; export function Child({ onChange }) { const [count] = useState(0); useEffect(() => { void onChange(count); }, [onChange, count]); return null; }",
      expectedCount: 0,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noPassLiveStateToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

describe("no-pass-live-state-to-parent — prop object native parity", () => {
  it.each([
    {
      name: "live-state-prop-object-object-rest-direct",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value = 0, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-search",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value = 0, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.search(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-notify",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value = 0, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.notify(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-fetch",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value = 0, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.fetchValue(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-other",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value = 0, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.whatever(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-excluded",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ onChange, ...props }) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-nested-object-rest",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ nested: { value, ...props } }) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-destructured-object",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ props }) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-default",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value, ...props } = {}) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-assigned",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value, ...props }) { const [state, setState] = useState(0); props = other; useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-member-write",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel({ value, ...props }) { const [state, setState] = useState(0); props.onChange = other; useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-whole-props",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel(props) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-object-rest",
      source:
        "import { useState, useEffect } from 'react'; export default function Panel(props) { const [state, setState] = useState(0); const { value, ...rest } = props; useEffect(() => { rest.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-set",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { props.setValue(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-handle",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { props.handleChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-computed",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { props['onChange'](state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-optional",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { props.onChange?.(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-object-rest-captured",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { const result = props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-no-state",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(value); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-object-rest-helper",
      source:
        "import { useState, useEffect } from 'react'; function Panel({value,...props}) { const [state, setState] = useState(0); const push = () => props.onChange(state); useEffect(() => { push(); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-destructured-object-alias",
      source:
        "import { useState, useEffect } from 'react'; function Panel({callbacks}) { const [state, setState] = useState(0); const bag=callbacks; useEffect(() => { bag.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-object-rest-set",
      source:
        "import { useState, useEffect } from 'react'; function Panel(props) { const [state, setState] = useState(0); const {value,...rest}=props; useEffect(() => { rest.setValue(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-custom-hook-any",
      source:
        "import { useState, useEffect } from 'react'; function usePanel({props}) { const [state, setState] = useState(0);  useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-custom-hook-callback",
      source:
        "import { useState, useEffect } from 'react'; function usePanel({callbacks}) { const [state, setState] = useState(0);  useEffect(() => { callbacks.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-parameter-mutated-later",
      source:
        "import { useState, useEffect } from 'react'; function Panel({props}) { const [state, setState] = useState(0); const mutate = () => { props = other; }; useEffect(() => { props.onChange(state); }, [state]); return <button onClick={() => setState(state + 1)} />; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-rest-excluded",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const {onChange,...rest}=props; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-rest-binding-write",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); let {value,...rest}=props; rest=other; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-rest-member-write",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const {value,...rest}=props; rest.onChange=other; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-rest-source-write",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const {value,...rest}=props; props=other; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-rest-from-destructured",
      source:
        "import {useState,useEffect} from 'react'; function Panel({props}) { const [state,setState]=useState(0); const {value,...rest}=props; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-property-from-whole",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const {handlers}=props; useEffect(()=>{handlers.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-alias-from-whole",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const bag=props; useEffect(()=>{bag.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-rest-from-whole-alias",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const bag=props; const {value,...rest}=bag; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-local-nested-rest-from-whole",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props) { const [state,setState]=useState(0); const {nested:{value,...rest}}=props; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-rest-hook",
      source:
        "import {useState,useEffect} from 'react'; function usePanel(props) { const [state,setState]=useState(0); const {value,...rest}=props; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-local-rest-default-whole",
      source:
        "import {useState,useEffect} from 'react'; function Panel(props={}) { const [state,setState]=useState(0); const {value,...rest}=props; useEffect(()=>{rest.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-rest-helper-binding-write",
      source:
        "import {useState,useEffect} from 'react'; function Panel({value,...props}) { const [state,setState]=useState(0); props=other; const push=()=>props.onChange(state); useEffect(()=>{push();},[state]); return null; }",
      expectedCount: 1,
    },
    {
      name: "live-state-prop-object-rest-api-namespace",
      source:
        "import {useState,useEffect} from 'react'; function Panel({value,...api}) { const [state,setState]=useState(0);  useEffect(()=>{api.onChange(state);},[state]); return null; }",
      expectedCount: 0,
    },
    {
      name: "live-state-prop-object-rest-object-param-default",
      source:
        "import {useState,useEffect} from 'react'; function Panel({value,...props}={}) { const [state,setState]=useState(0);  useEffect(()=>{props.onChange(state);},[state]); return null; }",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noPassLiveStateToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
