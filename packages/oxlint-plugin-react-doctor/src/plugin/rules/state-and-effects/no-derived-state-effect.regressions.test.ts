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

  it("flags the react-bnb-gallery Caption reseed even though a body handler toggles the state (task 63)", () => {
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
    expect(result.diagnostics).toHaveLength(1);
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

  it("stays silent when a guard branch does non-setter work", () => {
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
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an early-return guard (non-expression statement)", () => {
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
    expect(result.diagnostics).toEqual([]);
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
