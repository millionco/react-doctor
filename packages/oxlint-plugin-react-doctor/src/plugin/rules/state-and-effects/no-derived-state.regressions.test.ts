import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

// Must-detect anchors from react-bench-2. split/state PR #990's
// isControlledPropMirror exempted a prop->state mirror effect whenever the
// setter had ANY second call site in a handler — which is exactly the rule's
// canonical positive (the planted codecov SearchField bug). These regressions
// pin that the mirror still reports when the setter is only written from
// handler bodies, and that the controlled-mirror exemption applies solely to
// the mined FP shape: the setter itself passed to a child as an `on*` JSX
// callback (`onChange={setValue}`).

describe("no-derived-state — must-detect regressions", () => {
  // fix-react-rdh-codecov-gazebo-searchfield: guarded `setSearch(searchValue)`
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

  // fix-react-rdh-wojtekmaj-react-daterange-picker-daterangepicker:
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

  // fix-react-rdh-kurozenzen-r34-react-smallinput: `setInternalValue(value)`
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

  // fix-react-rdh-appflowy-io-appflowy-web-documenthistorymodal shape: the
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
  // ant-design .dumi DebouncedColorPicker: body-destructured prop mirror where
  // the setter itself is the child's onChange (`onChange={setValue}`) — the
  // state buffers the child's live edits, so a render-time derivation would
  // drop them.
  it("stays silent when the mirrored setter is passed as the child's onChange", () => {
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
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

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
