import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaleClosure } from "./no-stale-closure.js";

describe("no-stale-closure", () => {
  // ── useCallback with empty deps ──────────────────────────────────

  describe("useCallback — fail cases (stale closures)", () => {
    it("flags useCallback with empty deps capturing a prop", () => {
      const code = `
        const SearchInput = ({ onSearch }) => {
          const handler = useCallback(() => {
            onSearch("query");
          }, []);
          return <input onChange={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("onSearch");
      expect(result.diagnostics[0].message).toContain("stale");
    });

    it("flags useCallback with empty deps capturing useState value", () => {
      const code = `
        const Counter = () => {
          const [count, setCount] = useState(0);
          const log = useCallback(() => {
            console.log(count);
          }, []);
          return <button onClick={log}>{count}</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("count");
    });

    it("flags useCallback with empty deps capturing useContext value", () => {
      const code = `
        const ThemedButton = () => {
          const theme = useContext(ThemeContext);
          const getColor = useCallback(() => {
            return theme.primaryColor;
          }, []);
          return <button style={{ color: getColor() }}>Click</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("theme");
    });

    it("flags useCallback with empty deps capturing multiple reactive values", () => {
      const code = `
        const Form = ({ onSubmit }) => {
          const [name, setName] = useState("");
          const [email, setEmail] = useState("");
          const handleSubmit = useCallback(() => {
            onSubmit({ name, email });
          }, []);
          return <form onSubmit={handleSubmit} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("email");
      expect(result.diagnostics[0].message).toContain("name");
      expect(result.diagnostics[0].message).toContain("onSubmit");
    });

    it("flags useCallback with empty deps capturing useReducer state", () => {
      const code = `
        const App = () => {
          const [state, dispatch] = useReducer(reducer, initialState);
          const logState = useCallback(() => {
            console.log(state);
          }, []);
          return <div onClick={logState} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("state");
    });

    it("flags useCallback in a function-declaration component", () => {
      const code = `
        function Dashboard({ userId }) {
          const [data, setData] = useState(null);
          const refresh = useCallback(() => {
            fetchData(userId, data);
          }, []);
          return <button onClick={refresh}>Refresh</button>;
        }
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("data");
      expect(result.diagnostics[0].message).toContain("userId");
    });
  });

  // ── useCallback — pass cases (no stale closures) ─────────────────

  describe("useCallback — pass cases (not stale)", () => {
    it("passes when useCallback has correct deps", () => {
      const code = `
        const App = ({ value }) => {
          const handler = useCallback(() => {
            console.log(value);
          }, [value]);
          return <div onClick={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback with empty deps only uses stable values", () => {
      const code = `
        const App = () => {
          const [count, setCount] = useState(0);
          const increment = useCallback(() => {
            setCount(42);
          }, []);
          return <button onClick={increment}>{count}</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback with empty deps only uses refs", () => {
      const code = `
        const App = () => {
          const inputRef = useRef(null);
          const focusInput = useCallback(() => {
            inputRef.current.focus();
          }, []);
          return <input ref={inputRef} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback with empty deps has no captures", () => {
      const code = `
        const App = () => {
          const noop = useCallback(() => {
            console.log("hello");
          }, []);
          return <div onClick={noop} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback has no deps array", () => {
      const code = `
        const App = ({ value }) => {
          const handler = useCallback(() => {
            console.log(value);
          });
          return <div onClick={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback with empty deps only captures useReducer dispatch", () => {
      const code = `
        const App = () => {
          const [state, dispatch] = useReducer(reducer, initialState);
          const reset = useCallback(() => {
            dispatch({ type: "RESET" });
          }, []);
          return <button onClick={reset}>{state.count}</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback with empty deps only uses setter pattern names", () => {
      const code = `
        const App = () => {
          const [count, setCount] = useState(0);
          const [name, setName] = useState("");
          const resetAll = useCallback(() => {
            setCount(0);
            setName("");
          }, []);
          return <button onClick={resetAll} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when callback parameter shadows a reactive prop name", () => {
      const code = `
        const App = ({ value }) => {
          const handler = useCallback((value) => {
            console.log(value);
          }, []);
          return <div onClick={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when local variable inside callback shadows a reactive name", () => {
      const code = `
        const App = ({ items }) => {
          const compute = useCallback(() => {
            const items = [1, 2, 3];
            return items.length;
          }, []);
          return <div onClick={compute} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes for useCallback wrapping useEffectEvent result", () => {
      const code = `
        const App = ({ value }) => {
          const effectEvent = useEffectEvent(() => {
            console.log(value);
          });
          const handler = useCallback(() => {
            effectEvent();
          }, []);
          return <div onClick={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useCallback deps are non-empty (even if incomplete)", () => {
      const code = `
        const App = ({ value, name }) => {
          const handler = useCallback(() => {
            console.log(value, name);
          }, [value]);
          return <div onClick={handler} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ── useRef with stale callback ──────────────────────────────────

  describe("useRef — fail cases (stale closures)", () => {
    it("flags useRef initialized with function capturing reactive prop, never reassigned", () => {
      const code = `
        const App = ({ onEvent }) => {
          const callbackRef = useRef(() => {
            onEvent("fired");
          });
          useEffect(() => {
            api.subscribe(callbackRef.current);
            return () => api.unsubscribe(callbackRef.current);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("onEvent");
      expect(result.diagnostics[0].message).toContain("callbackRef.current");
    });

    it("flags useRef initialized with function capturing state value, never reassigned", () => {
      const code = `
        const Timer = () => {
          const [count, setCount] = useState(0);
          const tickRef = useRef(() => {
            console.log(count);
          });
          useEffect(() => {
            const id = setInterval(tickRef.current, 1000);
            return () => clearInterval(id);
          }, []);
          return <div>{count}</div>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("count");
    });
  });

  // ── useRef — pass cases (not stale) ──────────────────────────────

  describe("useRef — pass cases (not stale)", () => {
    it("passes when useRef function is reassigned via ref.current =", () => {
      const code = `
        const App = ({ onEvent }) => {
          const callbackRef = useRef(() => onEvent("init"));
          callbackRef.current = () => onEvent("updated");
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useRef stores a non-function value", () => {
      const code = `
        const App = ({ value }) => {
          const ref = useRef(value);
          return <div>{ref.current}</div>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useRef function only captures stable values", () => {
      const code = `
        const App = () => {
          const [count, setCount] = useState(0);
          const callbackRef = useRef(() => {
            setCount(0);
          });
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes when useRef stores null", () => {
      const code = `
        const App = ({ value }) => {
          const ref = useRef(null);
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ── Open-source-style patterns ──────────────────────────────────

  describe("real-world patterns from open-source codebases", () => {
    it("flags the debounced search pattern (stale prop callback)", () => {
      const code = `
        const SearchInput = ({ onSearch }) => {
          const [query, setQuery] = useState("");
          const debouncedSearch = useCallback(() => {
            onSearch(query);
          }, []);
          return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("onSearch");
      expect(result.diagnostics[0].message).toContain("query");
    });

    it("flags the analytics tracking pattern (stale context)", () => {
      const code = `
        const TrackableButton = ({ label }) => {
          const analytics = useContext(AnalyticsContext);
          const track = useCallback(() => {
            analytics.track("click", { label });
          }, []);
          return <button onClick={track}>{label}</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("analytics");
    });

    it("flags the interval callback pattern (stale state in ref)", () => {
      const code = `
        const Poller = ({ endpoint }) => {
          const [token, setToken] = useState(null);
          const pollRef = useRef(() => {
            fetch(endpoint, { headers: { Authorization: token } });
          });
          useEffect(() => {
            const id = setInterval(pollRef.current, 5000);
            return () => clearInterval(id);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("endpoint");
    });

    it("passes the correctly-updated ref pattern (useInsertionEffect)", () => {
      const code = `
        const App = ({ onChange }) => {
          const ref = useRef(onChange);
          ref.current = onChange;
          const stableCallback = useCallback((...args) => {
            ref.current(...args);
          }, []);
          return <input onChange={stableCallback} />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes the zustand selector pattern (no reactive capture)", () => {
      const code = `
        const App = () => {
          const selectCount = useCallback((state) => state.count, []);
          return <div />;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes the event handler with only setter calls", () => {
      const code = `
        const ToggleButton = () => {
          const [isOpen, setIsOpen] = useState(false);
          const toggle = useCallback(() => {
            setIsOpen((prev) => !prev);
          }, []);
          return <button onClick={toggle}>{isOpen ? "Close" : "Open"}</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes the navigation handler with stable dispatch", () => {
      const code = `
        const NavButton = () => {
          const [state, dispatch] = useReducer(reducer, initialState);
          const goHome = useCallback(() => {
            dispatch({ type: "NAVIGATE", payload: "/home" });
          }, []);
          return <button onClick={goHome}>Home</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags callback that reads destructured prop fields", () => {
      const code = `
        const Profile = ({ user }) => {
          const greet = useCallback(() => {
            alert("Hello, " + user.name);
          }, []);
          return <button onClick={greet}>Greet</button>;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("user");
    });

    it("does not flag non-component functions", () => {
      const code = `
        const useFoo = () => {
          const handler = useCallback(() => {
            console.log("hook");
          }, []);
          return handler;
        };
      `;
      const result = runRule(noStaleClosure, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
