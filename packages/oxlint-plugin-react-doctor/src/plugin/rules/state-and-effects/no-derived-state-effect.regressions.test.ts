import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

describe("no-derived-state-effect — regressions", () => {
  it("stays silent on a controlled-input mirror also written from onChange", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a pure mirror where the setter is only called by the effect", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <input value={draft} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on the react-bnb-gallery Caption reseed with an independent handler writer", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Caption({
        current = 0,
        onPress,
        photos = [],
        phrases = defaultPhrases,
        showThumbnails: showThumbnailsProp = true,
      }) {
        const [showThumbnails, setShowThumbnails] = useState(showThumbnailsProp);
        useEffect(() => {
          setShowThumbnails(showThumbnailsProp);
        }, [showThumbnailsProp]);
        const toggleThumbnails = () => {
          setShowThumbnails((prevState) => !prevState);
        };
        return <button onClick={toggleThumbnails}>{String(showThumbnails)}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on ant-design CodePreviewer: body-destructured prop mirror with inline JSX setter handlers", () => {
    const result = runRule(
      noDerivedStateEffect,
      `const CodePreviewer = (props) => {
        const { expand } = props;
        const [codeExpand, setCodeExpand] = useState(false);
        useEffect(() => {
          setCodeExpand(expand);
        }, [expand]);
        return <button onCodeExpand={() => setCodeExpand((prev) => !prev)}
                       onClick={() => setCodeExpand(false)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the same CodePreviewer mirror with the prop destructured in the params", () => {
    const result = runRule(
      noDerivedStateEffect,
      `const CodePreviewer = ({ expand }) => {
        const [codeExpand, setCodeExpand] = useState(false);
        useEffect(() => {
          setCodeExpand(expand);
        }, [expand]);
        return <button onCodeExpand={() => setCodeExpand((prev) => !prev)}
                       onClick={() => setCodeExpand(false)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a pure mirror when a nested component shadows the setter name in its own JSX", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        const Inner = () => {
          const [innerDraft, setDraft] = useState("");
          return <input onChange={(e) => setDraft(e.target.value)} value={innerDraft} />;
        };
        return <div><Inner /><span>{draft}</span></div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inline .filter derivations in an effect", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Todos({ todos }) {
        const [visibleTodos, setVisibleTodos] = useState([]);
        useEffect(() => {
          setVisibleTodos(todos.filter((todo) => !todo.done));
        }, [todos]);
        return <List items={visibleTodos} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a derived-state setter wrapped in an if guard", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Todos({ todos }) {
        const [visibleTodos, setVisibleTodos] = useState([]);
        useEffect(() => {
          if (todos.length > 0) {
            setVisibleTodos(todos.filter((todo) => !todo.done));
          }
        }, [todos]);
        return <List items={visibleTodos} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags guarded setters in both branches of an if/else", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Greeting({ name }) {
        const [greeting, setGreeting] = useState("");
        useEffect(() => {
          if (name) {
            setGreeting("Hello " + name);
          } else {
            setGreeting("Hello stranger");
          }
        }, [name]);
        return <span>{greeting}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a braceless if-guarded setter", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value !== draft) setDraft(value);
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy when a guard branch does other work", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Todos({ todos }) {
        const [visibleTodos, setVisibleTodos] = useState([]);
        useEffect(() => {
          if (todos.length > 0) {
            analytics.track("todos-updated");
            setVisibleTodos(todos.filter((todo) => !todo.done));
          }
        }, [todos]);
        return <List items={visibleTodos} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy after an early-return guard", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (!value) return;
          setDraft(value);
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a guarded controlled-input mirror also written from onChange", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value !== draft) {
            setDraft(value);
          }
        }, [value]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags member-expression dependencies like [user.name]", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Greeting({ user }) {
        const [greeting, setGreeting] = useState("");
        useEffect(() => {
          setGreeting("Hello " + user.name);
        }, [user.name]);
        return <span>{greeting}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-derived-state-effect — fuzz-hardening: guard flattening edges", () => {
  it("flags a braceless if with a braceless else, both setters", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) setDraft(value); else setDraft("");
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on an else-if ladder that only selects literal values", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState("");
        useEffect(() => {
          if (value === "a") setDraft("A");
          else if (value === "b") setDraft("B");
          else setDraft("");
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a setter behind doubly nested if guards", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) {
            if (value !== draft) {
              setDraft(value);
            }
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guard whose consequent holds a setter AND a nested if with another setter", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value, other }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) {
            setDraft(value);
            if (other) {
              setDraft(other);
            }
          }
        }, [value, other]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy when the else branch returns", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) {
            setDraft(value);
          } else {
            return;
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy before an early return", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          setDraft(value);
          return;
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy through a branch-local alias", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) {
            const next = value.trim();
            setDraft(next);
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy inside try/catch", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          if (value) {
            try {
              setDraft(value);
            } catch {}
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a switch statement wrapping setters", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState("");
        useEffect(() => {
          switch (value) {
            case "a":
              setDraft("A");
              break;
            default:
              setDraft("");
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the guarded call is a member-expression setter (store.setDraft)", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value, store }) {
        const [draft, setDraft] = useState("");
        useEffect(() => {
          if (value) {
            store.setDraft(value);
          }
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when a no-op statement pads the effect body", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { void 0; setDraft(value); }, [value]);
        return <input value={draft} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a proven copy beside other effect work", () => {
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { track(value); setDraft(value); }, [value]);
        return <input value={draft} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles a deep nested if chain without crashing and still flags the setter", () => {
    const openGuards = "if (value) { ".repeat(40);
    const closeGuards = " }".repeat(40);
    const result = runRule(
      noDerivedStateEffect,
      `function Field({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          ${openGuards}setDraft(value);${closeGuards}
        }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
