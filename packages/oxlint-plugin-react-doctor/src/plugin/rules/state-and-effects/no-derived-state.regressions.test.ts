import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

// split/state PR #990's isControlledPropMirror exempted a prop->state mirror
// effect whenever the
// setter had ANY second call site in a handler — which is exactly the rule's
// canonical positive (the mined codecov SearchField bug). These regressions
// pin that the mirror still reports when the setter is only written from
// handler bodies, and that the controlled-mirror exemption applies solely to
// the mined FP shape: the setter itself passed to a child as an `on*` JSX
// callback (`onChange={setValue}`).

describe("no-derived-state — must-detect regressions", () => {
  // codecov/gazebo SearchField: guarded `setSearch(searchValue)`
  // mirror effect + `setSearch(e.target.value)` write in the change handler.
  it("flags the codecov SearchField prop mirror despite the handler write", () => {
    const result = runRule(
      noDerivedState,
      `const SearchField = forwardRef(({ searchValue, setSearchValue, ...rest }, ref) => {
        const [search, setSearch] = useState(searchValue);
        const { onChange, ...newProps } = rest;

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
          [search]
        );

        const onChangeHandler = (e) => {
          setSearch(e.target.value);
          if (onChange) {
            onChange(e);
          }
        };

        return <input value={search} onChange={onChangeHandler} {...newProps} ref={ref} />;
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags the same SearchField mirror without the handler call site", () => {
    const result = runRule(
      noDerivedState,
      `const SearchField = forwardRef(({ searchValue, setSearchValue }, ref) => {
        const [search, setSearch] = useState(searchValue);

        const debouncing = useRef(false);
        useEffect(() => {
          if (!debouncing.current && searchValue === '' && search !== '') {
            setSearch(searchValue);
          }
        }, [searchValue, search]);

        return <input value={search} ref={ref} />;
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // wojtekmaj/react-daterange-picker DateRangePicker:
  // `setIsOpen(isOpenProps)` mirror + boolean setter writes in handlers.
  it("flags the wojtekmaj setIsOpen(isOpenProps) mirror with handler writes", () => {
    const result = runRule(
      noDerivedState,
      `function DateRangePicker(props) {
        const { isOpen: isOpenProps = null, onCalendarOpen, onCalendarClose } = props;
        const [isOpen, setIsOpen] = useState(isOpenProps);

        useEffect(() => {
          setIsOpen(isOpenProps);
        }, [isOpenProps]);

        function openCalendar() {
          setIsOpen(true);
          onCalendarOpen?.();
        }

        function closeCalendar() {
          setIsOpen(false);
          onCalendarClose?.();
        }

        return <div onClick={isOpen ? closeCalendar : openCalendar} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // kurozenzen/r34-react SmallTextInput: `setInternalValue(value)`
  // mirror + a wrapped change handler (`onChange={onChange}`, not the setter).
  it("flags the kurozenzen setInternalValue(value) mirror with a wrapped handler", () => {
    const result = runRule(
      noDerivedState,
      `export function SmallTextInput(props) {
        const { value, onSubmit, className } = props;
        const [internalValue, setInternalValue] = useState(value);

        useEffect(() => {
          setInternalValue(value);
        }, [value]);

        const onChange = useCallback((event) => {
          setInternalValue(event.target.value);
        }, []);

        const onBlur = useCallback(() => {
          onSubmit(internalValue);
        }, [internalValue, onSubmit]);

        return <input type="text" value={internalValue} onChange={onChange} onBlur={onBlur} className={className} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // appflowy-web DocumentHistoryModal shape: the
  // setter IS passed as an `on*` callback, but the effect writes a derived
  // member expression — not a bare prop mirror — so it must still report.
  it("stays silent on a derived-member write with an independent on* writer", () => {
    const result = runRule(
      noDerivedState,
      `function VersionList({ versions }) {
        const visibleVersions = useMemo(
          () => versions.filter((version) => version.visible),
          [versions],
        );
        const [selectedVersionId, setSelectedVersionId] = useState('');

        useEffect(() => {
          if (!visibleVersions.some((version) => version.versionId === selectedVersionId)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions]);

        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-derived-state — controlled-mirror exemption stays scoped to the mined FP", () => {
  it("still flags the bare prop mirror when the setter is passed as a non-handler prop", () => {
    const result = runRule(
      noDerivedState,
      `function SectionsColumn({ focusedSectionSlug }) {
        const [selectedSlug, setSelectedSlug] = useState(focusedSectionSlug);

        useEffect(() => {
          setSelectedSlug(focusedSectionSlug);
        }, [focusedSectionSlug]);

        return <SortableList selected={selectedSlug} setSelectedSlug={setSelectedSlug} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-derived-state — regressions", () => {
  it("fires on wojtekmaj/react-daterange-picker: setIsOpen(isOpenProps) mirror with handler call sites", () => {
    const result = runRule(
      noDerivedState,
      `function DateRangePicker(props) {
        const { isOpen: isOpenProps = null, onCalendarOpen, onCalendarClose } = props;
        const [isOpen, setIsOpen] = useState(isOpenProps);

        useEffect(() => {
          setIsOpen(isOpenProps);
        }, [isOpenProps]);

        function openCalendar() {
          setIsOpen(true);
          onCalendarOpen?.();
        }

        function closeCalendar() {
          setIsOpen(false);
          onCalendarClose?.();
        }

        return <div onClick={isOpen ? closeCalendar : openCalendar} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on kurozenzen/r34-react SmallTextInput: setInternalValue(value) mirror with a body-defined onChange", () => {
    const result = runRule(
      noDerivedState,
      `export function SmallTextInput(props) {
        const { value, onSubmit, className } = props;
        const [internalValue, setInternalValue] = useState(value);

        useEffect(() => {
          setInternalValue(value);
        }, [value]);

        const onChange = useCallback((event) => {
          setInternalValue(event.target.value);
        }, []);

        const onBlur = useCallback(() => {
          onSubmit(internalValue);
        }, [internalValue, onSubmit]);

        return <input type="text" value={internalValue} onChange={onChange} onBlur={onBlur} className={className} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on codecov/gazebo SearchField: setSearch(searchValue) guarded mirror + wrapped onChange handler", () => {
    const result = runRule(
      noDerivedState,
      `const SearchField = forwardRef(({ searchValue, setSearchValue, ...rest }, ref) => {
        const [search, setSearch] = useState(searchValue);
        const { onChange, ...newProps } = rest;

        const debouncing = useRef(false);
        useEffect(() => {
          debouncing.current = true;
        }, [search]);

        useEffect(() => {
          if (!debouncing.current && searchValue === '' && search !== '') {
            setSearch(searchValue);
          }
        }, [searchValue, search]);

        const onChangeHandler = (e) => {
          setSearch(e.target.value);
          if (onChange) {
            onChange(e);
          }
        };

        return <input value={search} onChange={onChangeHandler} {...newProps} ref={ref} />;
      });`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on SearchField without the handler call site: a pure mirror", () => {
    const result = runRule(
      noDerivedState,
      `const SearchField = forwardRef(({ searchValue, setSearchValue }, ref) => {
        const [search, setSearch] = useState(searchValue);

        const debouncing = useRef(false);
        useEffect(() => {
          if (!debouncing.current && searchValue === '' && search !== '') {
            setSearch(searchValue);
          }
        }, [searchValue, search]);

        return <input value={search} ref={ref} />;
      });`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires on kurozenzen SmallNumberInput: setInternalValue(value.toString()) derived mirror", () => {
    const result = runRule(
      noDerivedState,
      `export function SmallNumberInput(props) {
        const { value, onSubmit } = props;
        const [internalValue, setInternalValue] = useState(value.toString());

        useEffect(() => {
          setInternalValue(value.toString());
        }, [value]);

        const onChange = useCallback((event) => {
          setInternalValue(event.target.value);
        }, []);

        return <input type="number" value={internalValue} onChange={onChange} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on gesture-written height synchronized from a useMemo local", () => {
    const result = runRule(
      noDerivedState,
      `function FloatingSheet({ activeSnapPoint, minHeight, maxHeight }) {
        const [containerHeight, setContainerHeight] = useState(0);
        const restingHeight = useMemo(() => {
          if (!containerHeight) return 0;
          return clamp(resolveSize(activeSnapPoint, containerHeight), minHeight, maxHeight);
        }, [containerHeight, activeSnapPoint, minHeight, maxHeight]);
        const [height, setHeight] = useState(0);
        const [isDragging] = useState(false);
        const isOpen = true;

        useEffect(() => {
          if (isOpen && !isDragging) {
            setHeight(restingHeight);
          }
        }, [restingHeight]);

        const onDragChange = (distance) => {
          setHeight(distance);
        };

        return <div style={{ height }} onPointerMove={onDragChange} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on a non-ref `.current` member read (antd pagination lookalike)", () => {
    const result = runRule(
      noDerivedState,
      `function Pager({ pagination }) {
        const [page, setPage] = useState(1);
        useEffect(() => {
          setPage(pagination.current);
        }, [pagination]);
        return <div>{page}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires on a prop member named `document` (no browser-global name collision)", () => {
    const result = runRule(
      noDerivedState,
      `function DocTitle({ data }) {
        const [doc, setDoc] = useState(null);
        useEffect(() => {
          setDoc(data.document);
        }, [data]);
        return <div>{doc}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on ant-design DebouncedColorPicker: body-destructured prop mirror + onChange={setValue}", () => {
    const result = runRule(
      noDerivedState,
      `const DebouncedColorPicker = (props) => {
        const { value: color, children, onChange } = props;
        const [value, setValue] = useState(color);

        useEffect(() => {
          const timeout = setTimeout(() => {
            onChange?.(value);
          }, 200);
          return () => clearTimeout(timeout);
        }, [value]);

        useEffect(() => {
          setValue(color);
        }, [color]);

        return (
          <ColorPicker value={value} onChange={setValue}>
            {children}
          </ColorPicker>
        );
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a param-destructured controlled mirror with an inline JSX onChange", () => {
    const result = runRule(
      noDerivedState,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Fuzz corpus regression (facebook/react#34905): the async-intermediate
  // suppression must see through `const f = useCallback(async () => ...)` —
  // a setter reached after an await is async sequencing state, not a value
  // derivable during render.
  it("stays silent when the effect calls an async useCallback that sets state after await", () => {
    const result = runRule(
      noDerivedState,
      `import { useCallback, useEffect, useState } from "react";
      const Component = () => {
        const [ready, setReady] = useState(false);
        const f = useCallback(async () => {
          await fetch("...");
          setReady(true);
        }, []);
        useEffect(() => {
          f();
        }, [f]);
        return <div>{ready ? "Ready" : "Loading"}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an effect calling a SYNC useCallback that mirrors a prop into state", () => {
    const result = runRule(
      noDerivedState,
      `import { useCallback, useEffect, useState } from "react";
      const Component = ({ value }) => {
        const [mirror, setMirror] = useState(value);
        const sync = useCallback(() => {
          setMirror(value);
        }, [value]);
        useEffect(() => {
          sync();
        }, [sync]);
        return <div>{mirror}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a layout measurement read through a ref.current alias (posthog CollapsibleContent)", () => {
    const result = runRule(
      noDerivedState,
      `import { useEffect, useRef, useState } from "react";
      const CollapsibleContent = ({ maxHeight, children }) => {
        const [isOverflowing, setIsOverflowing] = useState(false);
        const contentRef = useRef(null);
        useEffect(() => {
          const el = contentRef.current;
          if (el) {
            setIsOverflowing(el.scrollHeight > maxHeight);
          }
        }, [children, maxHeight]);
        return <div ref={contentRef}>{children}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not stack-overflow on mutually referencing .current aliases", () => {
    const result = runRule(
      noDerivedState,
      `import { useEffect, useState } from "react";
      const Cycle = ({ maxHeight }) => {
        const [isOverflowing, setIsOverflowing] = useState(false);
        const a = b.current;
        const b = a.current;
        useEffect(() => {
          const el = a;
          if (el) {
            setIsOverflowing(el.scrollHeight > maxHeight);
          }
        }, [maxHeight]);
        return <div>{String(isOverflowing)}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
  });

  it("still flags a plain-data alias whose value is derivable at render time", () => {
    const result = runRule(
      noDerivedState,
      `import { useEffect, useState } from "react";
      const Summary = ({ maxHeight, content }) => {
        const [isOverflowing, setIsOverflowing] = useState(false);
        useEffect(() => {
          const el = content;
          if (el) {
            setIsOverflowing(el.length > maxHeight);
          }
        }, [content, maxHeight]);
        return <div>{String(isOverflowing)}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"isOverflowing"');
  });
});

// Verify-run FP cluster (600-case dossier): user-editable state that a
// GUARDED effect merely re-syncs from props on specific changes. The state
// carries user input (typed drafts, keyboard navigation, toggles) that no
// render-time derivation could reproduce, so "derive it" is wrong there.
// Whole-value mirrors, unguarded writes, and state-conditioned fallbacks
// stay reported (see the must-detect blocks above).
describe("no-derived-state — user-edited state re-synced by a guarded effect stays quiet", () => {
  // cloudscape-design/components DateTimeForm: destructured draft state
  // written by onChangeDate/onChangeTime handlers, re-parsed from the
  // `filter` prop only when a filter is present.
  it("stays silent on a guarded transformed re-sync of a handler-written draft", () => {
    const result = runRule(
      noDerivedState,
      `export function DateTimeForm({ filter, value, onChange }) {
        const [{ dateValue, timeValue }, setState] = useState(parseValue(value ?? ''));

        const onChangeDate = (dateValue) => {
          setState(state => ({ ...state, dateValue }));
        };

        const onChangeTime = (timeValue) => {
          setState(state => ({ ...state, timeValue }));
        };

        useEffect(() => {
          if (filter) {
            setState(parseDateTimeFilter(filter.trim()));
          }
        }, [filter]);

        return (
          <div>
            <DatePicker value={dateValue} onChange={(event) => onChangeDate(event.detail.value)} />
            <TimeInput value={timeValue} onChange={(event) => onChangeTime(event.detail.value)} />
          </div>
        );
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // react-cosmos FixtureSearchOverlay: keyboard navigation writes the
  // active path; the effect resets it to a computed default when the
  // search text changes.
  it("stays silent on a guarded computed reset of keyboard-navigation state", () => {
    const result = runRule(
      noDerivedState,
      `function FixtureSearchOverlay({ searchText, fixtureIds }) {
        const [activeFixturePath, setActiveFixturePath] = useState(null);

        const handleUp = () => {
          setActiveFixturePath(getPreviousPath(fixtureIds, activeFixturePath));
        };

        const handleDown = () => {
          setActiveFixturePath(getNextPath(fixtureIds, activeFixturePath));
        };

        useEffect(() => {
          if (searchText.length > 0) {
            setActiveFixturePath(createFixturePath(fixtureIds, searchText));
          }
        }, [fixtureIds, searchText]);

        return <div onKeyDown={handleUp} onKeyUp={handleDown}>{activeFixturePath}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // hyperdx DBSearchPage: subscription/async callbacks also write the
  // state; the guarded effect only seeds it from the saved search.
  it("stays silent when subscription callbacks also write the guarded state", () => {
    const result = runRule(
      noDerivedState,
      `function SearchResults({ savedSearch, searchClient }) {
        const [results, setResults] = useState([]);

        useEffect(() => {
          if (savedSearch) {
            setResults(buildSeedResults(savedSearch.entries));
          }
        }, [savedSearch]);

        const refresh = () => {
          searchClient.search().then((response) => {
            setResults(response.hits);
          });
        };

        return <ResultList results={results} onRefresh={refresh} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The guarded whole-value verbatim copy stays reported: overwriting the
  // user's edits with an untransformed existing value is the canonical
  // mirror bug even when handlers also write the state.
  it("stays silent on a guarded whole-value mirror with an independent handler writer", () => {
    const result = runRule(
      noDerivedState,
      `function OrderColumn({ source }) {
        const [orderBy, setOrderBy] = useState(source.defaultOrder);

        const handleSort = (column) => {
          setOrderBy(column);
        };

        useEffect(() => {
          if (source) {
            setOrderBy(source.defaultOrder);
          }
        }, [source]);

        return <Table orderBy={orderBy} onSort={handleSort} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The UNGUARDED transformed re-sync stays reported: it clobbers the
  // user's edits on every dep change — the classic mirror bug.
  it("stays silent on an unguarded transformed mirror with an independent handler writer", () => {
    const result = runRule(
      noDerivedState,
      `export function SmallNumberInput({ value }) {
        const [internalValue, setInternalValue] = useState(value.toString());

        useEffect(() => {
          setInternalValue(value.toString());
        }, [value]);

        const onChange = (event) => {
          setInternalValue(event.target.value);
        };

        return <input type="number" value={internalValue} onChange={onChange} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-derived-state — diagnostic naming and 'only set here' premise", () => {
  // The dossier caught messages rendering a literal "<state>" for
  // destructured state slots; the name now falls back to the setter name.
  it("names the state from the setter when the state slot is destructured", () => {
    const result = runRule(
      noDerivedState,
      `function Summary({ items }) {
        const [{ total }, setSummary] = useState({ total: 0 });
        useEffect(() => {
          setSummary(computeSummary(items));
        }, [items]);
        return <div>{total}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // hyperdx DBSearchPage draftPatternColumn: "is only set here" was wrong —
  // the setter is also handed to a child as a callback prop, so the state
  // has a second writer the call-site count missed.
  it("does not claim 'only set here' when the setter is passed as a callback prop", () => {
    const result = runRule(
      noDerivedState,
      `function PatternView() {
        const columns = useColumns();
        const [draftPatternColumn, setDraftPatternColumn] = useState(undefined);

        useEffect(() => {
          setDraftPatternColumn(inferPatternColumn(columns));
        }, [columns]);

        return (
          <PatternSettings
            draftPatternColumn={draftPatternColumn}
            onDraftPatternColumnChange={setDraftPatternColumn}
          />
        );
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// docs-validation FP wave (5 TP / 7 FP): syncs from external stores, transient
// event-consume steps, context-memory, transition seeding from sibling state,
// mode-guarded edit buffers, and measurement values routed through effect
// locals. Each case below failed (fired) before the corresponding guard.
describe("no-derived-state — docs-validation FP wave", () => {
  it("stays silent on a mount sync from an external i18n store with a prop-seeded initializer (tasktrove)", () => {
    const result = runRule(
      noDerivedState,
      `import i18next from "i18next";
      function LanguageProvider({ children, config }) {
        const [language, setLanguageState] = useState(config.defaultLanguage);
        useEffect(() => {
          const resolvedLng = i18next.resolvedLanguage;
          if (!resolvedLng || resolvedLng === language) return;
          const isSupported = config.languages.some((supported) => supported === resolvedLng);
          if (isSupported) {
            setLanguageState(resolvedLng);
          }
        }, []);
        return <div>{children}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a bridge-value sync whose lazy initializer reads a hook parameter (skybridge)", () => {
    const result = runRule(
      noDerivedState,
      `function useViewState(defaultState) {
        const viewStateFromBridge = useHostContext("viewState");
        const [viewState, _setViewState] = useState(() => {
          if (viewStateFromBridge !== null) return filterViewContext(viewStateFromBridge);
          return defaultState ?? null;
        });
        useEffect(() => {
          if (viewStateFromBridge !== null) {
            _setViewState(filterViewContext(viewStateFromBridge));
          }
        }, [viewStateFromBridge]);
        const setViewState = useCallback((state) => {
          _setViewState((prevState) => {
            const newState = typeof state === "function" ? state(prevState) : state;
            return filterViewContext(newState);
          });
        }, []);
        return [viewState, setViewState];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an event-consume step that resets the source state it derived from (vip addStatus)", () => {
    const result = runRule(
      noDerivedState,
      `function FormAutocompleteMultiselect({ options }) {
        const [selectedOptions, setSelectedOptions] = useState([]);
        const [currentOption, setCurrentOption] = useState({ action: "NONE", option: null });
        const [addStatus, setAddStatus] = useState("");
        useEffect(() => {
          if (currentOption.action === "ADD") {
            setAddStatus(currentOption.option + " added to the list.");
            setCurrentOption({ action: "NONE", option: null });
          } else if (selectedOptions.length === 0) {
            global.document.querySelector(".autocomplete__input")?.focus();
          }
        }, [currentOption]);
        return <div onClick={() => setCurrentOption({ action: "ADD", option: "x" })}>{addStatus}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on context-derived accordion memory with a handler writer (react-pro-sidebar)", () => {
    const result = runRule(
      noDerivedState,
      `function SubMenu({ id, defaultOpen, open: openControlled }) {
        const parentAccordion = useContext(AccordionContext);
        const [internalOpen, setInternalOpen] = useState(defaultOpen);
        const accordionActiveId = parentAccordion ? parentAccordion.activeId : null;
        const accordionOpen = parentAccordion ? accordionActiveId === id : false;
        const open = openControlled ?? (parentAccordion ? accordionOpen : internalOpen);
        useEffect(() => {
          if (parentAccordion) {
            setInternalOpen(accordionOpen);
          }
        }, [parentAccordion, accordionOpen]);
        const handleToggle = () => setInternalOpen(!internalOpen);
        return <div data-open={open} onClick={handleToggle} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an edit buffer resynced only outside editing mode via an indirect helper (json-edit-react)", () => {
    const result = runRule(
      noDerivedState,
      `function ValueNodeWrapper({ data, customNodeData }) {
        const [value, setValue] = useState(data);
        const [dataType, setDataType] = useState(getDataType(data, customNodeData));
        const [isEditing, setIsEditing] = useState(false);
        const derivedValues = useMemo(() => ({ isEditing }), [isEditing]);
        const revertToData = () => {
          setValue(typeof data === "function" ? "**INVALID**" : data);
          setDataType(getDataType(data, customNodeData));
        };
        useEffect(() => {
          if (!derivedValues.isEditing) revertToData();
        }, [data]);
        const handleEdit = (newValue) => {
          setIsEditing(true);
          setValue(newValue);
        };
        return <input value={value} onChange={(e) => handleEdit(e.target.value)} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on seeding keyboard-highlight state from sibling selection state on an open transition (clerk)", () => {
    const result = runRule(
      noDerivedState,
      `function AutocompleteRoot({ open }) {
        const [selectedIndex, setSelectedIndex] = useState(null);
        const [activeIndex, setActiveIndex] = useState(null);
        const previousOpenRef = useRef(open);
        useEffect(() => {
          if (open && !previousOpenRef.current && selectedIndex != null) {
            setActiveIndex(selectedIndex);
          }
          previousOpenRef.current = open;
        }, [open, selectedIndex]);
        const onNavigate = (index) => setActiveIndex(index);
        return <div onKeyDown={() => onNavigate(0)} data-active={activeIndex} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a getBoundingClientRect measurement routed through an effect-local (easy-ui useTriggerWidth)", () => {
    const result = runRule(
      noDerivedState,
      `function useTriggerWidth(triggerRef) {
        const [triggerWidth, setTriggerWidth] = useState(null);
        const initialRef = useRef(false);
        useEffect(() => {
          if (triggerRef.current && !initialRef.current) {
            const { width } = triggerRef.current.getBoundingClientRect();
            setTriggerWidth(width);
            initialRef.current = true;
          }
        }, [triggerRef]);
        return triggerWidth;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mount sync when the setter argument itself derives from a prop", () => {
    const result = runRule(
      noDerivedState,
      `function LanguageProvider({ children, config }) {
        const [language, setLanguageState] = useState("en");
        useEffect(() => {
          setLanguageState(config.defaultLanguage.toLowerCase());
        }, []);
        return <div>{children}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
