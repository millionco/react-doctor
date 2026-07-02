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
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"search"');
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
    expect(result.diagnostics).toHaveLength(1);
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
    expect(result.diagnostics).toHaveLength(1);
  });

  // appflowy-web DocumentHistoryModal shape: the
  // setter IS passed as an `on*` callback, but the effect writes a derived
  // member expression — not a bare prop mirror — so it must still report.
  it("flags a derived-member write even when the setter is an on* JSX callback", () => {
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
    expect(result.diagnostics).toHaveLength(1);
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires on lobehub FloatingSheet: setHeight(restingHeight) from a useMemo local", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
});
