import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

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

describe("no-pass-live-state-to-parent — must-detect regressions", () => {
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
