import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

describe("no-direct-state-mutation", () => {
  it("flags member assignment on plain-object state", () => {
    const result = runRule(
      noDirectStateMutation,
      `
      function Form() {
        const [user, setUser] = useState({ n: "" });
        const onChange = (x) => {
          user.n = x;
        };
        return <input onChange={onChange} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("user");
  });

  it("flags a mutating array method on array-literal state", () => {
    const result = runRule(
      noDirectStateMutation,
      `
      function Cart() {
        const [items, setItems] = useState([]);
        const onAdd = (next) => {
          items.push(next);
        };
        return <button onClick={() => onAdd("x")}>{items.length}</button>;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("items");
  });

  it("flags member assignment on null-initialized state (instance arrives via setter)", () => {
    const result = runRule(
      noDirectStateMutation,
      `
      function CodeBox({ readOnly }) {
        const [editor, setEditor] = useState(null);
        useEffect(() => {
          if (editor) editor.options.readOnly = readOnly;
        }, [editor, readOnly]);
        return <div ref={(el) => { if (el && !editor) setEditor(createEditor(el)); }} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("editor");
  });

  it("does not flag member assignment on a directly-constructed instance", () => {
    const result = runRule(
      noDirectStateMutation,
      `
      function CodeBox({ readOnly }) {
        const [editor, setEditor] = useState(new EditorEngine());
        useEffect(() => {
          editor.options.readOnly = readOnly;
        }, [editor, readOnly]);
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
