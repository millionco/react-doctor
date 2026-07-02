import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEventHandler } from "./no-event-handler.js";

describe("no-event-handler — regressions", () => {
  it("fires on a mount effect syncing storage into state (bench: digitalocean sea-notes Theme)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  it("fires on a setter-only consequent doing real event work (bench: sickdyd autocomplete)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  it("still reports the prop when a sibling tested state is exclusively listener-driven", () => {
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
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("with a prop")),
    ).toBe(true);
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
    expect(productionResult.diagnostics.length).toBeGreaterThan(0);
  });
});
