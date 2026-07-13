import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEventHandler } from "./no-event-handler.js";

// Must-detect anchors distilled from mined real-world bug shapes (the
// 0.5.7 -> 0.5.8 regression review). Each fixture keeps the surrounding
// context an overbroad FP guard is most likely to key on — post-mount reads
// (`window` / `document` / `.current`), setter-only if-consequents, and
// deferred setter call sites elsewhere in the component — so a whole-scope
// bailout added for an FP flips these tests. Silence a mined FP with a
// narrower, shape-specific guard instead.

const expectBroadInferenceStaysSilent = (
  code: string,
  legacyMinimumDiagnosticCount: number,
): void => {
  const result = runRule(noEventHandler, code);
  expect(result.parseErrors).toEqual([]);
  expect(legacyMinimumDiagnosticCount).toBeGreaterThan(0);
  expect(result.diagnostics).toEqual([]);
};

describe("no-event-handler — must-detect regressions", () => {
  it("stays silent when an effect returns an unknown cleanup parameter", () => {
    const result = runRule(
      noEventHandler,
      `const useForwardedEffect = (cleanup) => {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (active) window.alert("active");
    return cleanup;
  }, [active]);
  return setActive;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on memo-derived state with mixed async writers", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on key-press state with DOM focus work", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on a prop and state reset guard with mutable-ref evidence", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on a setter-only consequent", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on submit status with mixed timer writers", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on uncontrolled active-node synchronization", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on cache-ref-guarded color synchronization", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on a setter-only stage transition", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on focus state with a timer writer", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on pager-height synchronization", () => {
    expectBroadInferenceStaysSilent(
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

  it("stays silent on previous-value mirror guards", () => {
    expectBroadInferenceStaysSilent(
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

describe("no-event-handler — regressions", () => {
  it("stays silent on guarded parent registration with the returned cleanup", () => {
    const result = runRule(
      noEventHandler,
      `function AccordionItem({ isStandalone, itemKey }) {
        const itemStateContext = useAccordionItemState();
        useEffect(() => {
          if (!isStandalone) return itemStateContext?.registerItemKey(itemKey);
        }, [isStandalone, itemKey, itemStateContext]);
        return <div>{itemKey}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports handler-written state relayed through a guarded effect", () => {
    const result = runRule(
      noEventHandler,
      `function AccordionItem({ onOpen }) {
        const [didRequestOpen, setDidRequestOpen] = useState(false);
        useEffect(() => {
          if (didRequestOpen) onOpen();
        }, [didRequestOpen, onOpen]);
        return <button onClick={() => setDidRequestOpen(true)}>Open</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Flipped by the 67k-diagnostic verification run: a `[]`-deps effect whose
  // tested state is only ever set by the mount effect itself is one-time
  // initialization (no-initialize-state territory), not a faked event
  // handler. Handler-set state tested under `[]` deps still fires.
  it("stays silent on a []-deps mount effect syncing storage into state (digitalocean sea-notes Theme)", () => {
    const result = runRule(
      noEventHandler,
      `function MaterialThemeProvider({ children }) {
        const [mode, setMode] = useState('light');
        const [currentTheme, setCurrentTheme] = useState('modernize');
        useEffect(() => {
          if (typeof window !== 'undefined') {
            const storedMode = localStorage.getItem('themeMode');
            const storedTheme = localStorage.getItem('currentTheme') || 'modernize';
            if (storedMode && storedMode !== mode) setMode(storedMode);
            if (storedTheme !== currentTheme) setCurrentTheme(storedTheme);
          }
        }, []);
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on a true positive despite an incidental window read in the effect", () => {
    const result = runRule(
      noEventHandler,
      `function Form() {
        const [submitted, setSubmitted] = useState(false);
        const [data, setData] = useState(null);
        useEffect(() => {
          if (submitted) {
            submitData(data);
            window.scrollTo(0, 0);
          }
        }, [submitted]);
        return <button onClick={() => setSubmitted(true)}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on setter-only synchronization", () => {
    const result = runRule(
      noEventHandler,
      `function Search({ items, maxResults, showItemsOnFocus }) {
        const [results, setResults] = useState([]);
        const [searchString, setSearchString] = useState("");
        const [hasFocus, setHasFocus] = useState(false);
        useEffect(() => {
          const handleClick = () => setHasFocus(false);
          document.addEventListener("click", handleClick);
          return () => document.removeEventListener("click", handleClick);
        }, []);
        useEffect(() => {
          if (showItemsOnFocus && results.length === 0 && searchString.length === 0 && hasFocus) {
            setResults(items.slice(0, maxResults));
          }
        }, [hasFocus]);
        return <input onFocus={() => setHasFocus(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires when the consequent defers a callback through setTimeout", () => {
    const result = runRule(
      noEventHandler,
      `function Toast({ onShow }) {
        const [visible, setVisible] = useState(false);
        useEffect(() => {
          if (visible) setTimeout(onShow, 0);
        }, [visible]);
        return <button onClick={() => setVisible(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the consequent mutates the DOM via setAttribute", () => {
    const result = runRule(
      noEventHandler,
      `function Dialog() {
        const [open, setOpen] = useState(false);
        useEffect(() => {
          if (open) {
            dialogEl.setAttribute('open', '');
          }
        }, [open]);
        return <button onClick={() => setOpen(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not infer an event source from a prop beside listener-driven state", () => {
    const result = runRule(
      noEventHandler,
      `function Combo({ showItemsOnFocus, onItems, items }) {
        const [hasFocus, setHasFocus] = useState(false);
        useEffect(() => {
          const onDocClick = () => setHasFocus(false);
          document.addEventListener("click", onDocClick);
          return () => document.removeEventListener("click", onDocClick);
        }, []);
        useEffect(() => {
          if (showItemsOnFocus && hasFocus) {
            onItems(items);
          }
        }, [hasFocus, showItemsOnFocus]);
        return <div />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the controlled/uncontrolled prop mirror", () => {
    const result = runRule(
      noEventHandler,
      `function ControlledInput({ value: valueProp, defaultValue, onChange }) {
        const [value, setValue] = useState(valueProp ?? defaultValue ?? "");
        useEffect(() => {
          if (valueProp !== undefined) setValue(valueProp);
        }, [valueProp]);
        return (
          <input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              onChange?.(event.target.value);
            }}
          />
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a guard reading exclusively matchMedia-listener-driven state", () => {
    const result = runRule(
      noEventHandler,
      `function Theme({ onChange }) {
        const [dark, setDark] = useState(false);
        useEffect(() => {
          const mq = window.matchMedia("(prefers-color-scheme: dark)");
          const handler = (event) => setDark(event.matches);
          mq.addEventListener("change", handler);
          return () => mq.removeEventListener("change", handler);
        }, []);
        useEffect(() => {
          if (dark) onChange?.(dark);
        }, [dark]);
        return <div>{dark ? "dark" : "light"}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in docs-tooling files (ant-design .dumi image prefetch)", () => {
    const code = `function Group({ backgroundPrefetchList }) {
      useEffect(() => {
        if (backgroundPrefetchList && backgroundPrefetchList.length > 0) {
          backgroundPrefetchList.forEach((url) => {
            const img = new Image();
            img.src = url;
          });
        }
      }, [backgroundPrefetchList]);
      return null;
    }`;
    const dumiResult = runRule(noEventHandler, code, {
      filename: "/repo/.dumi/pages/index/components/Group.tsx",
      forceJsx: true,
    });
    expect(dumiResult.parseErrors).toEqual([]);
    expect(dumiResult.diagnostics).toEqual([]);
    const productionResult = runRule(noEventHandler, code, {
      filename: "/repo/src/components/Group.tsx",
      forceJsx: true,
    });
    expect(productionResult.diagnostics).toEqual([]);
  });

  it("stays silent when the guard reads state from an opaque custom hook (cloudscape useFilterProps)", () => {
    const result = runRule(
      noEventHandler,
      `export default function useFilterProps(series, controlledVisibleSeries, controlledOnVisibleChange) {
        const [visibleSeries = [], setVisibleSeriesState] = useControllable(
          controlledVisibleSeries,
          controlledOnVisibleChange,
          series,
          { componentName: 'AreaChart', controlledProp: 'visibleSeries', changeHandler: 'onFilterChange' },
        );
        const setVisibleSeries = useCallback((selectedSeries) => {
          setVisibleSeriesState(selectedSeries);
          fireNonCancelableEvent(controlledOnVisibleChange, { visibleSeries: selectedSeries });
        }, [controlledOnVisibleChange, setVisibleSeriesState]);
        useEffect(() => {
          const newVisibleSeries = visibleSeries.filter(s => series.indexOf(s) !== -1);
          if (newVisibleSeries.length !== visibleSeries.length) {
            setVisibleSeries(newVisibleSeries);
          }
        }, [series, visibleSeries, setVisibleSeries]);
        return [visibleSeries, setVisibleSeries];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a null-guard-tested external instance sync (aws graph-explorer cy.zoom)", () => {
    const result = runRule(
      noEventHandler,
      `export const useManageConfigChanges = (config, cy) => {
        const { zoom } = config;
        useEffect(() => {
          if (cy && cy.zoom() !== zoom) {
            cy.zoom(zoom);
          }
        }, [cy, zoom]);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a ref-rooted DOM focus consequent", () => {
    const result = runRule(
      noEventHandler,
      `function Grid({ focusedDate }) {
        const [gridHasFocus, setGridHasFocus] = useState(false);
        const elementRef = useRef(null);
        useEffect(() => {
          if (focusedDate && gridHasFocus) {
            elementRef.current?.focus();
          }
        }, [focusedDate, gridHasFocus]);
        return <div ref={elementRef} onFocus={() => setGridHasFocus(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a window.scrollTo consequent", () => {
    const result = runRule(
      noEventHandler,
      `function Page({ step }) {
        const [submitted, setSubmitted] = useState(false);
        useEffect(() => {
          if (submitted) {
            window.scrollTo(0, 0);
          }
        }, [submitted, step]);
        return <button onClick={() => setSubmitted(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the consequent syncs a custom-hook service instance", () => {
    const result = runRule(
      noEventHandler,
      `function Layer({ visible }) {
        const layerService = useLayerState();
        useEffect(() => {
          if (visible) {
            layerService.show();
          }
        }, [visible]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a ref-rooted animation play call (lottie)", () => {
    const result = runRule(
      noEventHandler,
      `function Icon({ active }) {
        const animationRef = useRef(null);
        useEffect(() => {
          if (active) {
            animationRef.current?.play();
          }
        }, [active]);
        return <Lottie ref={animationRef} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the tested state's setter is handed by reference to a promise", () => {
    const result = runRule(
      noEventHandler,
      `function Preview({ fileId, onReady }) {
        const [blobUrl, setBlobUrl] = useState(null);
        useEffect(() => {
          resolveBlobUrl(fileId).then(setBlobUrl);
        }, [fileId]);
        useEffect(() => {
          if (blobUrl) {
            onReady(blobUrl);
          }
        }, [blobUrl]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a redirect reacting to async-driven auth state", () => {
    const result = runRule(
      noEventHandler,
      `function Guard({ children }) {
        const [user, setUser] = useState(null);
        useEffect(() => {
          fetchSession().then(setUser);
        }, []);
        useEffect(() => {
          if (!user) {
            router.push('/login');
          }
        }, [user]);
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the consequent only reassigns an effect-local binding (kaihotz usePhonenumber)", () => {
    const result = runRule(
      noEventHandler,
      `export const usePhonenumber = ({ initialValue, initialCountry, format }) => {
        const [state, dispatch] = useReducer(phoneReducer, initialState);
        useEffect(() => {
          let payload = { country: initialCountry, phoneNumber: '' };
          if (initialValue && typeof initialValue === 'string') {
            payload = { country: findCountryFor(initialValue), phoneNumber: initialValue };
          }
          dispatch({ type: 'onChange', payload });
        }, [format, initialCountry, initialValue]);
        return state;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a for-loop guard assigning an effect-local accumulator (json-edit-react useAppliedBroadcast)", () => {
    const result = runRule(
      noEventHandler,
      `export const useAppliedBroadcast = (path, animateCollapse) => {
        const { commands, version } = useCollapse();
        useEffect(() => {
          if (!commands) return;
          let lastMatching;
          for (const cmd of commands) {
            if (matchesPath(path, cmd)) lastMatching = cmd;
          }
          if (!lastMatching) return;
          animateCollapse(lastMatching.collapsed);
        }, [version, commands]);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a dev-only warning comparing a non-Ref-named useRef against the current value (frimousse Search)", () => {
    const result = runRule(
      noEventHandler,
      `const Search = ({ value, defaultValue, onChange }) => {
        const isControlled = typeof value === "string";
        const wasControlled = useRef(isControlled);
        useEffect(() => {
          if (process.env.NODE_ENV !== "production" && wasControlled.current !== isControlled) {
            console.warn("Search is switching between controlled and uncontrolled.");
          }
          wasControlled.current = isControlled;
        }, [isControlled]);
        return <input value={value} onChange={onChange} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a usePrevious-vs-current-prop transition guard (trendyol Carousel)", () => {
    const result = runRule(
      noEventHandler,
      `const Carousel = (userProps) => {
        const props = { ...defaultProps, ...userProps };
        const [items, setItems] = useState([]);
        const [page, setPage] = useState(0);
        const prevChildren = usePrevious(userProps.children);
        useEffect(() => {
          setItems(updateNodes(props.children, prevChildren));
          if (page < props.pageCount && prevChildren && prevChildren.length < props.children.length) {
            slide();
            setPage(page + 1);
          }
        }, [props.children]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the guard tests only effect-local derived values (mailing usePreviewTree cursor sync)", () => {
    const result = runRule(
      noEventHandler,
      `export function usePreviewTree(previews) {
        const [cursor, setCursor] = useState(-1);
        const [treeRoutes, setTreeRoutes] = useState(undefined);
        useEffect(() => {
          if (cursor !== -1 || !treeRoutes) return;
          const path = decodeURIComponent(router.asPath.split("?")[0]);
          const idx = treeRoutes.findIndex((route) => route.path === path);
          if (idx >= 0) setCursor(idx);
        }, [cursor, treeRoutes]);
        return { cursor, navigate: (next) => setCursor(next) };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a dispatch-then-return retry preamble (hightable ScrollProvider)", () => {
    const result = runRule(
      noEventHandler,
      `export function ScrollProvider({ children }) {
        const [scrollTo, setScrollTo] = useState(undefined);
        const { focusState, focusDispatch } = useContext(CellNavigationContext);
        useEffect(() => {
          if (focusState.status !== 'should_scroll_into_view') return;
          if (!scrollTo) {
            focusDispatch({ type: 'CANNOT_SCROLL_YET' });
            return;
          }
          scrollTo({ top: 0, behavior: 'instant' });
          focusDispatch({ type: 'GLOBAL_SCROLLING_STARTED' });
        }, [scrollTo, focusState, focusDispatch]);
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the consequent directly calls a custom-hook-returned function (hightable goToCell)", () => {
    const result = runRule(
      noEventHandler,
      `function Pager({ total }) {
        const [pageIndex, setPageIndex] = useState(0);
        const { goToPage } = usePagination();
        useEffect(() => {
          if (pageIndex > total) {
            goToPage(total);
          }
        }, [pageIndex, total, goToPage]);
        return <button onClick={() => setPageIndex(pageIndex + 1)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("suppresses the prop report when the guard also tests opaque-hook async data (openmrs AddTaskForm)", () => {
    const result = runRule(
      noEventHandler,
      `const AddTaskForm = ({ editTaskUuid }) => {
        const isEditMode = Boolean(editTaskUuid);
        const { task: existingTask } = useTask(editTaskUuid);
        const [selectedTask, setSelectedTask] = useState(null);
        useEffect(() => {
          if (isEditMode && existingTask) {
            setSelectedTask(existingTask);
          }
        }, [isEditMode, existingTask]);
        return <button onClick={() => setSelectedTask(null)}>clear</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a config-gated zero-arg call of a deps-listed useCallback (mailing leavesOnly)", () => {
    const result = runRule(
      noEventHandler,
      `export function usePreviewTree(previews, options = {}) {
        const { leavesOnly } = options;
        const [cursor, setCursor] = useState(-1);
        const down = useCallback(() => setCursor((current) => current + 1), []);
        const goToNearestLeaf = useCallback(() => {
          if (cursor === -1) return;
          down();
        }, [cursor, down]);
        useEffect(() => {
          if (leavesOnly) goToNearestLeaf();
        }, [leavesOnly, goToNearestLeaf]);
        return { cursor };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on a truthiness-guarded useReducer dispatch without an early exit", () => {
    const result = runRule(
      noEventHandler,
      `function Wizard() {
        const [visible, setVisible] = useState(false);
        const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
        useEffect(() => {
          if (visible) dispatch({ type: 'open' });
        }, [visible]);
        return <button onClick={() => setVisible(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires on a zero-arg prop-callback invocation guarded by handler state", () => {
    const result = runRule(
      noEventHandler,
      `function Modal({ onOpen }) {
        const [open, setOpen] = useState(false);
        useEffect(() => {
          if (open) onOpen();
        }, [open, onOpen]);
        return <button onClick={() => setOpen(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a []-deps mount effect restoring persisted state", () => {
    const result = runRule(
      noEventHandler,
      `function Checkout() {
        const [error, setError] = useState(null);
        useEffect(() => {
          const sessionStorageError = sessionStorage.getItem('checkout-error');
          if (sessionStorageError) {
            setError(sessionStorageError);
          }
        }, []);
        return error ? <Banner>{error}</Banner> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Delta-verify recall regression (appflowy DeletePageConfirm): the guard
  // conjoins a plain `open` prop with a memo whose upstream walk stops at an
  // opaque hook (useAppView). The memo is a transparent derivation — NOT
  // directly-tested async hook data — so the opaque-hook stop must not veto
  // the prop report: `open` flipping true runs void handleOk() (a delete!).
  it("stays silent on a prop-flipped effect without handler-proven state", () => {
    const result = runRule(
      noEventHandler,
      `function DeletePageConfirm({ open, onClose, viewId, onDeleted }) {
        const view = useAppView(viewId);
        const [loading, setLoading] = useState(false);
        const { deletePage } = useAppOperations();
        const handleOk = useCallback(async () => {
          if (!view) return;
          setLoading(true);
          try {
            await deletePage?.(viewId);
            onClose();
            onDeleted?.();
          } finally {
            setLoading(false);
          }
        }, [deletePage, onClose, onDeleted, view, viewId]);
        const hasPublished = useMemo(() => {
          const publishedView = filterViewsByCondition(view?.children || [], (v) => v.is_published);
          return view?.is_published || !!publishedView.length;
        }, [view]);
        useEffect(() => {
          if (!hasPublished && open) {
            void handleOk();
          }
        }, [handleOk, hasPublished, open]);
        if (!hasPublished) return null;
        return <NormalModal open={open} onClose={onClose} onOk={handleOk} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
