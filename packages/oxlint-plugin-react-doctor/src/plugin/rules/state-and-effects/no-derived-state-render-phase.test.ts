import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const run = (code: string): ReturnType<typeof runRule> =>
  runRule(noDerivedState, code, { filename: "fixture.tsx", forceJsx: true });

describe("no-derived-state — render-phase compare-and-set", () => {
  it("flags the Rad UI state-tracker prop mirror", () => {
    const result = run(`
      function Theme({ accentColor }) {
        const [previousAccentColor, setPreviousAccentColor] = useState(accentColor);
        const [themeAccentColor, setThemeAccentColor] = useState(accentColor);

        if (accentColor !== previousAccentColor) {
          setPreviousAccentColor(accentColor);
          setThemeAccentColor(accentColor);
        }

        return <ThemeContext.Provider value={themeAccentColor} />;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("themeAccentColor");
  });

  it("flags a pure transform through an immutable alias and module helper", () => {
    const result = run(`
      const normalizeTheme = (value) => value.trim().toLowerCase();

      function Theme({ appearance }) {
        const nextAppearance = appearance;
        const previousAppearance = useRef(nextAppearance);
        const [theme, setTheme] = useState(normalizeTheme(nextAppearance));

        if (previousAppearance.current !== nextAppearance) {
          previousAppearance.current = nextAppearance;
          setTheme(normalizeTheme(nextAppearance));
        }

        return <output>{theme}</output>;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags state derived exclusively from another state value", () => {
    const result = run(`
      function Picker() {
        const [selection, setSelection] = useState("first");
        const previousSelection = useRef(selection);
        const [label, setLabel] = useState(selection.toUpperCase());

        if (selection !== previousSelection.current) {
          previousSelection.current = selection;
          setLabel(selection.toUpperCase());
        }

        return <button onClick={() => setSelection("second")}>{label}</button>;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves aliased and namespace React hooks", () => {
    const aliasedResult = run(`
      import { useRef as usePrevious, useState as useValue } from "react";
      function Theme({ appearance }) {
        const previousAppearance = usePrevious(appearance);
        const [theme, setTheme] = useValue(appearance);
        if (appearance !== previousAppearance.current) {
          previousAppearance.current = appearance;
          setTheme(appearance);
        }
        return theme;
      }
    `);
    const namespaceResult = run(`
      import * as React from "react";
      function Theme({ appearance }) {
        const [previousAppearance, setPreviousAppearance] = React.useState(appearance);
        const [theme, setTheme] = React.useState(appearance);
        if (previousAppearance !== appearance) {
          setPreviousAppearance(appearance);
          setTheme(appearance);
        }
        return theme;
      }
    `);

    expect(aliasedResult.parseErrors).toEqual([]);
    expect(namespaceResult.parseErrors).toEqual([]);
    expect(aliasedResult.diagnostics).toHaveLength(1);
    expect(namespaceResult.diagnostics).toHaveLength(1);
  });

  it("preserves existing effect-derived-state detection", () => {
    const result = run(`
      function Name({ firstName, lastName }) {
        const [fullName, setFullName] = useState("");
        useEffect(() => {
          setFullName(firstName + " " + lastName);
        }, [firstName, lastName]);
        return fullName;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "previous-value tracking without a destination state write",
      source: `
        function Counter({ count }) {
          const previousCount = useRef(count);
          if (count !== previousCount.current) {
            previousCount.current = count;
          }
          return previousCount.current;
        }
      `,
    },
    {
      name: "guarded ref initialization",
      source: `
        function Cache({ value }) {
          const cacheRef = useRef(null);
          if (cacheRef.current === null) {
            cacheRef.current = createCache(value);
          }
          return cacheRef.current;
        }
      `,
    },
    {
      name: "ref-only sticky value tracking",
      source: `
        function useStickyValue(value) {
          const lastNonEmptyRef = useRef(value);
          if (value) {
            lastNonEmptyRef.current = value;
          }
          return lastNonEmptyRef.current;
        }
      `,
    },
    {
      name: "latest-value ref writes",
      source: `
        function FloatingSheet({ height }) {
          const heightRef = useRef(height);
          heightRef.current = height;
          useEffect(() => readHeight(heightRef.current), []);
          return null;
        }
      `,
    },
    {
      name: "Divz semi-controlled state",
      source: `
        function Divz({ isExpanded, autoPlay }) {
          const previousIsExpanded = useRef(isExpanded);
          const previousAutoPlay = useRef(autoPlay);
          const [expanded, setExpanded] = useState(isExpanded);
          const [playing, setPlaying] = useState(autoPlay);

          if (previousIsExpanded.current !== isExpanded) {
            previousIsExpanded.current = isExpanded;
            setExpanded(isExpanded);
          }
          if (previousAutoPlay.current !== autoPlay) {
            previousAutoPlay.current = autoPlay;
            setPlaying(autoPlay);
          }

          return (
            <button
              onClick={() => setExpanded((current) => !current)}
              onDoubleClick={() => setPlaying((current) => !current)}
            >
              {expanded && playing ? "playing" : "paused"}
            </button>
          );
        }
      `,
    },
    {
      name: "FloatingSheet transition and gesture state",
      source: `
        function FloatingSheet({ isOpen, restingHeight, isDragging }) {
          const previousOpenRef = useRef(isOpen);
          const previousRestingHeightRef = useRef(restingHeight);
          const [height, setHeight] = useState(restingHeight);
          const [isAnimating, setIsAnimating] = useState(false);
          const [isClosing, setIsClosing] = useState(false);

          if (isOpen !== previousOpenRef.current) {
            previousOpenRef.current = isOpen;
            previousRestingHeightRef.current = restingHeight;
            setIsAnimating(true);
            if (isOpen) {
              setIsClosing(false);
              setHeight(restingHeight);
            } else {
              setIsClosing(true);
              setHeight(0);
            }
          } else if (restingHeight !== previousRestingHeightRef.current) {
            previousRestingHeightRef.current = restingHeight;
            if (isOpen && !isDragging) setHeight(restingHeight);
          }

          return <div onPointerMove={(event) => setHeight(event.clientY)}>{height}</div>;
        }
      `,
    },
    {
      name: "Brainly-style semi-controlled selection",
      source: `
        function RadioGroup({ value }) {
          const previousValue = useRef(value);
          const [selectedValue, setSelectedValue] = useState(value);

          if (value !== previousValue.current) {
            previousValue.current = value;
            setSelectedValue(value);
          }

          return <Radio value={selectedValue} onChange={setSelectedValue} />;
        }
      `,
    },
    {
      name: "Cosmos-style keyboard state reset",
      source: `
        function FixtureSearch({ searchText }) {
          const previousSearchText = useRef(searchText);
          const [activePath, setActivePath] = useState(null);

          if (searchText !== previousSearchText.current) {
            previousSearchText.current = searchText;
            setActivePath(null);
          }

          return <div onKeyDown={() => setActivePath("next")}>{activePath}</div>;
        }
      `,
    },
    {
      name: "transition state seeded from sibling state",
      source: `
        function Autocomplete({ open }) {
          const [selectedIndex] = useState(0);
          const [activeIndex, setActiveIndex] = useState(null);
          const previousOpen = useRef(open);

          if (open !== previousOpen.current) {
            previousOpen.current = open;
            if (open) setActiveIndex(selectedIndex);
          }

          return <div onKeyDown={() => setActiveIndex(1)}>{activeIndex}</div>;
        }
      `,
    },
    {
      name: "Prisma-style independently toggled expansion state",
      source: `
        function ModelSection({ expanded }) {
          const previousExpanded = useRef(expanded);
          const [isExpanded, setIsExpanded] = useState(expanded);

          if (expanded !== previousExpanded.current) {
            previousExpanded.current = expanded;
            setIsExpanded(expanded);
          }

          return <button onClick={() => setIsExpanded((current) => !current)}>{String(isExpanded)}</button>;
        }
      `,
    },
    {
      name: "DateRangePicker controlled and uncontrolled state",
      source: `
        function DateRangePicker({ isOpen: isOpenProp }) {
          const previousIsOpen = useRef(isOpenProp);
          const [isOpen, setIsOpen] = useState(isOpenProp);

          if (isOpenProp !== previousIsOpen.current) {
            previousIsOpen.current = isOpenProp;
            setIsOpen(isOpenProp);
          }

          return <button onClick={() => setIsOpen((current) => !current)}>{String(isOpen)}</button>;
        }
      `,
    },
    {
      name: "gallery index reset with an independent writer",
      source: `
        function Gallery({ current }) {
          const previousCurrent = useRef(current);
          const [selectedIndex, setSelectedIndex] = useState(current);

          if (current !== previousCurrent.current) {
            previousCurrent.current = current;
            setSelectedIndex(current);
          }

          return <button onClick={() => setSelectedIndex((index) => index + 1)}>{selectedIndex}</button>;
        }
      `,
    },
    {
      name: "external-store snapshots",
      source: `
        function StoreStatus({ store }) {
          const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
          const previousSnapshot = useRef(snapshot);
          const [status, setStatus] = useState(snapshot);

          if (snapshot !== previousSnapshot.current) {
            previousSnapshot.current = snapshot;
            setStatus(snapshot);
          }

          return status;
        }
      `,
    },
    {
      name: "unknown helper results",
      source: `
        import { deriveTheme } from "theme-library";
        function Theme({ appearance }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(deriveTheme(appearance));
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(deriveTheme(appearance));
          }
          return theme;
        }
      `,
    },
    {
      name: "mutable source aliases",
      source: `
        function Theme({ appearance }) {
          let nextAppearance = appearance;
          const previousAppearance = useRef(nextAppearance);
          const [theme, setTheme] = useState(nextAppearance);
          nextAppearance = normalizeTheme(nextAppearance);
          if (nextAppearance !== previousAppearance.current) {
            previousAppearance.current = nextAppearance;
            setTheme(nextAppearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "functional destination updaters",
      source: `
        function Theme({ appearance }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(() => appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "compound guards",
      source: `
        function Theme({ appearance, enabled }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (enabled && appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "nested destination setters",
      source: `
        function Theme({ appearance, enabled }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            if (enabled) setTheme(appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "member-path mismatches",
      source: `
        function Theme({ settings }) {
          const appearance = settings.appearance;
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(settings.theme);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(settings.theme);
          }
          return theme;
        }
      `,
    },
    {
      name: "destination initializers from a different source",
      source: `
        function Theme({ appearance, defaultTheme }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(defaultTheme);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "setters passed to child components",
      source: `
        function Theme({ appearance }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(appearance);
          }
          return <ThemeEditor value={theme} onChange={setTheme} />;
        }
      `,
    },
    {
      name: "locally shadowed React hooks",
      source: `
        const useRef = (value) => ({ current: value });
        const useState = (value) => [value, () => {}];
        function Theme({ appearance }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = appearance;
            setTheme(appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "trackers not synchronized in the branch",
      source: `
        function Theme({ appearance }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            setTheme(appearance);
          }
          return theme;
        }
      `,
    },
    {
      name: "tracker writes from a different source",
      source: `
        function Theme({ appearance, fallback }) {
          const previousAppearance = useRef(appearance);
          const [theme, setTheme] = useState(appearance);
          if (appearance !== previousAppearance.current) {
            previousAppearance.current = fallback;
            setTheme(appearance);
          }
          return theme;
        }
      `,
    },
  ])("stays quiet for $name", ({ source }) => {
    const result = run(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
