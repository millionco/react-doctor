import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEventHandler } from "./no-event-handler.js";

// Must-detect anchors distilled from react-bench-2 planted-bug before-files
// (the 0.5.7 -> 0.5.8 regression review). Each fixture keeps the surrounding
// context an overbroad FP guard is most likely to key on — post-mount reads
// (`window` / `document` / `.current`), setter-only if-consequents, and
// deferred setter call sites elsewhere in the component — so a whole-scope
// bailout added for an FP flips these tests. Silence a mined FP with a
// narrower, shape-specific guard instead.

const expectFiresAtLeast = (code: string, minimumDiagnosticCount: number): void => {
  const result = runRule(noEventHandler, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(minimumDiagnosticCount);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.message).toContain("Faking an event handler");
  }
};

describe("no-event-handler — bench must-detect regressions", () => {
  it("fires on memo-derived state tested in an effect with ref bookkeeping and an async setter elsewhere (appflowy DocumentHistoryModal)", () => {
    expectFiresAtLeast(
      `
      const DocumentHistoryModal = ({ open, viewId }: { open: boolean; viewId: string }) => {
        const currentUser = useCurrentUser();
        const { getCollabHistory } = useCollabHistory();
        const [versions, setVersions] = useState([]);
        const [selectedVersionId, setSelectedVersionId] = useState('');
        const [dateFilter, setDateFilter] = useState('all');
        const [onlyShowMine, setOnlyShowMine] = useState(false);
        const selectedVersionIdRef = useRef(selectedVersionId);

        selectedVersionIdRef.current = selectedVersionId;

        const visibleVersions = useMemo(() => {
          let filtered = [...versions];

          if (onlyShowMine && currentUser) {
            filtered = filtered.filter((version) => version.editors.includes(currentUser.uid));
          }

          return filtered.filter((version) => {
            if (dateFilter === 'all') {
              return true;
            }

            return version.ageInDays <= 7;
          });
        }, [versions, onlyShowMine, currentUser, dateFilter]);

        const refreshVersions = useCallback(async () => {
          const data = await getCollabHistory(viewId);
          setVersions(data.filter((version) => !version.deletedAt));
        }, [viewId, getCollabHistory]);

        useEffect(() => {
          if (!open) {
            return;
          }

          void refreshVersions();
        }, [open, refreshVersions]);

        useEffect(() => {
          if (visibleVersions.length === 0) {
            if (selectedVersionIdRef.current) {
              setSelectedVersionId('');
            }

            return;
          }

          if (!visibleVersions.some((version) => version.versionId === selectedVersionIdRef.current)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions]);

        return (
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onDateFilterChange={setDateFilter}
            onOnlyShowMineChange={setOnlyShowMine}
          />
        );
      };
      `,
      4,
    );
  });

  it("fires on key-press effects whose consequents mix setters with DOM focus calls (catho Autocomplete)", () => {
    expectFiresAtLeast(
      `
      const Autocomplete = ({ value, suggestions, onSelectedItem = () => {} }) => {
        const [userTypedValue, setUserTypedValue] = useState(value);
        const [filterSuggestions, setFilterSuggestions] = useState(suggestions);
        const [filterSuggestionsLength, setFilterSuggestionsLength] = useState(filterSuggestions.length);
        const [showSuggestions, setShowSuggestions] = useState(false);
        const [cursor, setCursor] = useState(-1);
        const listOptions = useRef();
        const autoInputRef = useRef(null);

        const focusOnInput = () => autoInputRef.current.focus();

        const handleFilter = (typedValue) => {
          setUserTypedValue(typedValue);
          setFilterSuggestions(suggestions.filter((suggestion) => suggestion.includes(typedValue)));
          setShowSuggestions(true);
        };

        const downPress = useKeyPress('ArrowDown');
        const enterPress = useKeyPress('Enter');

        useEffect(() => {
          setFilterSuggestionsLength(filterSuggestions?.length);
        }, [filterSuggestions]);

        useEffect(() => {
          if (showSuggestions && filterSuggestionsLength && downPress) {
            const selectedCursor = cursor < filterSuggestionsLength - 1 ? cursor + 1 : cursor;
            setCursor(selectedCursor);
            listOptions.current.children[selectedCursor].focus();
          }
        }, [downPress]);

        useEffect(() => {
          if (showSuggestions && filterSuggestionsLength && enterPress) {
            setUserTypedValue(filterSuggestions[cursor]);
            onSelectedItem(filterSuggestions[cursor]);
            setShowSuggestions(false);
            focusOnInput();
          }
        }, [cursor, enterPress]);

        useEffect(() => {
          if (document.activeElement === autoInputRef.current) {
            handleFilter(userTypedValue);
          }
        }, [suggestions]);

        return null;
      };
      `,
      4,
    );
  });

  it("fires on a prop/state reset guard reading a non-Ref-named mutable flag (codecov SearchField)", () => {
    expectFiresAtLeast(
      `
      const SearchField = ({ searchValue, setSearchValue, onChange }) => {
        const [search, setSearch] = useState(searchValue);

        const debouncing = useRef(false);
        useEffect(() => {
          debouncing.current = true;
        }, [search]);

        useEffect(() => {
          if (!debouncing.current && searchValue === '' && search !== '') {
            setSearch(searchValue);
          }
        }, [searchValue, search]);

        useDebounce(
          () => {
            setSearchValue(search);
            debouncing.current = false;
          },
          500,
          [search],
        );

        const onChangeHandler = (event) => {
          setSearch(event.target.value);
          if (onChange) {
            onChange(event);
          }
        };

        return <TextInput value={search} onChange={onChangeHandler} />;
      };
      `,
      2,
    );
  });

  it("fires on a setter-only consequent syncing state from props (intljusticemission TimeGutter)", () => {
    expectFiresAtLeast(
      `
      const TimeGutter = ({ min, max, timeslots, step, localizer }) => {
        const { start, end } = useMemo(() => adjustForDST({ min, max, localizer }), [min, max, localizer]);
        const [slotMetrics, setSlotMetrics] = useState(
          getSlotMetrics({ min: start, max: end, timeslots, step, localizer }),
        );

        useEffect(() => {
          if (slotMetrics) {
            setSlotMetrics(slotMetrics.update({ min: start, max: end, timeslots, step, localizer }));
          }
        }, [start, end, timeslots, step]);

        return null;
      };
      `,
      2,
    );
  });

  it("fires on a submit-status effect while another setter runs inside setTimeout (latitude Form)", () => {
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

  it("fires on an uncontrolled-active-node reset next to a DOM-focus effect (nteract AccessibleNavTree)", () => {
    expectFiresAtLeast(
      `
      const AccessibleNavTree = ({ tree, activeId: controlledActiveId }: Props) => {
        const [expanded, setExpanded] = React.useState(() => new Set([tree.id]));
        const [internalActiveId, setInternalActiveId] = React.useState(tree.id);
        const isControlled = controlledActiveId !== undefined;
        const activeId = isControlled ? controlledActiveId : internalActiveId;
        const containerRef = React.useRef(null);
        const itemRefs = React.useRef(new Map());

        const order = React.useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

        React.useEffect(() => {
          if (isControlled) return;
          if (!order.some((visibleNode) => visibleNode.id === internalActiveId)) setInternalActiveId(tree.id);
        }, [order, internalActiveId, tree.id, isControlled]);

        React.useEffect(() => {
          if (containerRef.current?.contains(document.activeElement)) {
            itemRefs.current.get(activeId)?.focus();
          }
        }, [activeId]);

        return null;
      };
      `,
      2,
    );
  });

  it("fires on cache-ref-guarded color sync effects (react-colorful useColorManipulation)", () => {
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
      4,
    );
  });

  it("fires on a setter-only stage-transition consequent (openfootmanager MatchSimulation)", () => {
    expectFiresAtLeast(
      `
      const MatchSimulation = ({ matchMode }: { matchMode: string }) => {
        const [stage, setStage] = useState('prematch');
        const [isSpectator, setIsSpectator] = useState(matchMode === 'spectator');

        useEffect(() => {
          if (isSpectator && stage === 'prematch') {
            setStage('first_half');
          }
        }, [isSpectator, stage]);

        return null;
      };
      `,
      2,
    );
  });

  it("fires on a focus-results guard whose tested state is also set in a setTimeout elsewhere (sickdyd ReactSearchAutocomplete)", () => {
    expectFiresAtLeast(
      `
      const ReactSearchAutocomplete = ({ items, inputSearchString, showItemsOnFocus, maxResults }: Props) => {
        const [searchString, setSearchString] = useState(inputSearchString);
        const [results, setResults] = useState([]);
        const [hasFocus, setHasFocus] = useState(false);

        useEffect(() => {
          setSearchString(inputSearchString);
          const timeoutId = setTimeout(() => setResults(fuseResults(inputSearchString)), 0);

          return () => clearTimeout(timeoutId);
        }, [inputSearchString]);

        useEffect(() => {
          if (showItemsOnFocus && results.length === 0 && searchString.length === 0 && hasFocus) {
            setResults(items.slice(0, maxResults));
          }
        }, [showItemsOnFocus, results, searchString, hasFocus]);

        return null;
      };
      `,
      4,
    );
  });

  it("fires on a pager-height sync guard (tim-soft ImagePager)", () => {
    expectFiresAtLeast(
      `
      const ImagePager = ({ imageStageHeight, inline }: Props) => {
        const [pagerHeight, setPagerHeight] = useState('100%');

        useEffect(() => {
          const currPagerHeight = inline ? imageStageHeight : imageStageHeight - 50;

          if (currPagerHeight !== pagerHeight) {
            setPagerHeight(currPagerHeight);
          }
        }, [inline, pagerHeight, imageStageHeight]);

        return null;
      };
      `,
      3,
    );
  });

  it("stays silent when the tested state is set only by a matchMedia listener", () => {
    const result = runRule(
      noEventHandler,
      `const Theme = ({ onChange }) => {
        const [dark, setDark] = useState(false);
        useEffect(() => {
          const mq = window.matchMedia('(prefers-color-scheme: dark)');
          const handler = (event) => setDark(event.matches);
          mq.addEventListener('change', handler);
          return () => mq.removeEventListener('change', handler);
        }, []);
        useEffect(() => {
          if (dark) onChange?.(dark);
        }, [dark]);
        return <div>{dark ? 'dark' : 'light'}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the tested state is set only by a useCallback-wrapped resize listener", () => {
    const result = runRule(
      noEventHandler,
      `const Viewport = ({ onResize }) => {
        const [width, setWidth] = useState(0);
        const handleResize = useCallback(() => setWidth(window.innerWidth), []);
        useEffect(() => {
          window.addEventListener('resize', handleResize);
          return () => window.removeEventListener('resize', handleResize);
        }, [handleResize]);
        useEffect(() => {
          if (width > 0) onResize?.(width);
        }, [width]);
        return <div>{width}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on previous-value mirror guards mixing setters with ref writes (viclafouch usePhoneDigits)", () => {
    expectFiresAtLeast(
      `
      const usePhoneDigits = ({ value, defaultCountry, onChange }: Params) => {
        const asYouTypeRef = React.useRef(new AsYouType(defaultCountry));
        const previousCountryRef = React.useRef(null);
        const [previousValue, setPreviousValue] = React.useState(value);
        const [previousDefaultCountry, setPreviousDefaultCountry] = React.useState(defaultCountry);
        const [state, setState] = React.useState(() => getInitialState({ initialValue: value, defaultCountry }));

        React.useEffect(() => {
          if (value !== previousValue) {
            setPreviousValue(value);
            const newState = getInitialState({ initialValue: value, defaultCountry });
            previousCountryRef.current = newState.isoCode;
            setState(newState);
          }
        }, [value, previousValue, defaultCountry]);

        React.useEffect(() => {
          if (defaultCountry !== previousDefaultCountry) {
            setPreviousDefaultCountry(defaultCountry);
            asYouTypeRef.current = new AsYouType(defaultCountry);
            const { inputValue, isoCode } = getInitialState({ initialValue: '', defaultCountry });
            setPreviousValue(inputValue);
            onChange?.(inputValue);
            setState({ inputValue, isoCode });
          }
        }, [defaultCountry, previousDefaultCountry]);

        return { state };
      };
      `,
      4,
    );
  });
});
