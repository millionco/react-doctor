import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noControlledInputValueWithoutStateUpdate } from "./no-controlled-input-value-without-state-update.js";

describe("no-controlled-input-value-without-state-update", () => {
  it("flags input with a string-literal value and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" onChange={(e) => log(e)} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags input with a numeric-literal value {123} and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value={123} onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags textarea with a literal value and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <textarea value="frozen" onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag value bound to state with an updating onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => {
        const [value, setValue] = useState("");
        return <input value={value} onChange={(e) => setValue(e.target.value)} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value bound to a prop identifier (syntax-only, no FP)", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const MyInput = ({ value }) => <input value={value} onChange={(e) => log(e)} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a readOnly input with a literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" readOnly onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a disabled input with a literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" disabled onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal value with no onChange (a different footgun)", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer editability from an explicitly empty presentation-only handler", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const ToolbarDemo = () => <input value="Search..." onChange={() => {}} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer editability from nullish or pure void expression-body handlers", () => {
    const undefinedResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="Search..." onChange={() => undefined} />;`,
    );
    const nullResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <textarea value="Search..." onChange={() => (null)} />;`,
    );
    const voidLiteralResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="Search..." onChange={() => void 0} />;`,
    );
    const wrappedVoidLiteralResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <textarea value="Search..." onChange={() => void (0 as const)} />;`,
    );
    expect(undefinedResult.diagnostics).toHaveLength(0);
    expect(nullResult.diagnostics).toHaveLength(0);
    expect(voidLiteralResult.diagnostics).toHaveLength(0);
    expect(wrappedVoidLiteralResult.diagnostics).toHaveLength(0);
  });

  it("still flags effectful expression-body handlers", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Call = () => <input value="Search..." onChange={() => void log("change")} />;
      const Getter = () => <input value="Search..." onChange={() => void source.value} />;
      const Assignment = () => <input value="Search..." onChange={() => void (state = 1)} />;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag a radio whose literal value is the submission token", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input type="radio" value="a" checked onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a checkbox literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input type="checkbox" value="a" onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a generic radio component with dynamic type and explicit checked", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Radio = ({ type, checked, onChange }) => <input type={type} checked={checked} value="a" onChange={onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag type={'radio'} written as an expression container", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input type={"radio"} value="a" checked={sel} onChange={h} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic type={type} input, which may resolve to radio/checkbox/hidden", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ type, onChange }) => <input type={type} value="a" onChange={onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Solid files, where a static value only sets the initial value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `import { createSignal } from "solid-js";
const C = () => <input value="" onChange={(e) => setQuery(e.currentTarget.value)} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a spread could supply onChange/value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" {...rest} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on the idle branch of a draft/commit row with a state-driven twin", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const NewOptionRow = ({ onCreate }) => {
         const [draft, setDraft] = useState(null);
         if (draft !== null) {
           return (
             <input
               value={draft}
               autoFocus
               onChange={(event) => setDraft(event.target.value)}
               onBlur={() => {
                 if (draft.trim() !== "") onCreate(draft.trim());
                 setDraft(null);
               }}
             />
           );
         }
         return (
           <input value="" placeholder="Add option" onChange={(event) => setDraft(event.target.value)} />
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a visually-hidden typing-capture proxy input", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const TypingCapture = ({ onCharacterTyped, onBackspace }) => (
         <input
           className="sr-only"
           autoFocus
           autoComplete="off"
           aria-label="Typing area"
           value=""
           onKeyDown={(event) => {
             if (event.key === "Backspace") onBackspace();
           }}
           onChange={(event) => onCharacterTyped(event.target.value)}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a honeypot decoy field pinned to the empty string", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const ContactForm = ({ onSubmit }) => {
         const [isLikelyBot, setIsLikelyBot] = useState(false);
         return (
           <form onSubmit={(event) => { event.preventDefault(); if (!isLikelyBot) onSubmit(); }}>
             <input
               type="text"
               name="company_website"
               tabIndex={-1}
               autoComplete="off"
               aria-hidden="true"
               style={{ position: "absolute", left: "-10000px" }}
               value=""
               onChange={() => setIsLikelyBot(true)}
             />
             <button type="submit">Send</button>
           </form>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a lone frozen input even when the component renders another literal-value input", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Search = ({ onSubmit }) => (
         <div>
           <input value="" onChange={(event) => onSubmit(event.target.value)} />
           <input value="fixed" onChange={() => {}} />
         </div>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a frozen input beside an unrelated state-driven input", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Form = () => {
         const [query, setQuery] = useState("");
         return <><input value={query} onChange={(event) => setQuery(event.target.value)} /><input value="fixed" onChange={submit} /></>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on handlers whose block or expression returns only an ignored literal", () => {
    const blockResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="fixed" onChange={() => { return; }} />;`,
    );
    const literalResult = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="fixed" onChange={() => false} />;`,
    );
    expect(blockResult.diagnostics).toHaveLength(0);
    expect(literalResult.diagnostics).toHaveLength(0);
  });
});
