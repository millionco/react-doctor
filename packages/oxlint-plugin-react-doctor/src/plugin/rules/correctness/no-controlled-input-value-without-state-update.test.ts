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

  it.each(["button", "submit", "reset", "image", "file"])(
    "does not flag a non-editable type=%s value label or token",
    (inputType) => {
      const result = runRule(
        noControlledInputValueWithoutStateUpdate,
        `<input type="${inputType}" value="Save" onChange={track} />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

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

  it("recognizes a literal direct consequent and state-driven fallback return", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         if (draft === null) return <input value="" onChange={(event) => setDraft(event.target.value)} />;
         return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes state-driven and literal returns in direct if/else branches", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         if (draft !== null) return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
         else return <input value="" onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes state-driven and literal returns across an else-if chain", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         if (draft === null) return <input value="" onChange={(event) => setDraft(event.target.value)} />;
         else if (draft !== null) return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not pair an unrelated outer branch with a nested state-driven return", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft, isEditing }) => {
         if (isEditing) {
           if (draft !== null) {
             return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
           }
         }
         return <input value="" onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair a related outer branch with a nested unrelated return gate", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft, isEditing }) => {
         if (draft !== null) {
           if (isEditing) {
             return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
           }
         }
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair opposite branches through a nested unrelated return gate", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft, isEditing }) => {
         if (draft !== null) {
           if (isEditing) return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
         } else {
           return <input value="fixed" onChange={submit} />;
         }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes state-driven and literal results in a conditional expression", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         return draft === null
           ? <input value="" onChange={(event) => setDraft(event.target.value)} />
           : <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer alternative results from a logical fallback expression", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         return (draft !== null && <input value={draft} onChange={(event) => setDraft(event.target.value)} />) ||
           <input value="" onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not use non-returning conditional JSX as a state-driven alternative", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft, showPreview }) => {
         showPreview && <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unreachable right side of a JSX logical expression as an alternative", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft }) => {
         return <input value="fixed" onChange={submit} /> ||
           <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["<span />", "true", "false", '"always"'])(
    "does not treat a sibling behind the static logical condition %s as an alternative",
    (condition) => {
      const result = runRule(
        noControlledInputValueWithoutStateUpdate,
        `const Field = ({ draft, setDraft }) => {
           return (${condition} && <input value={draft} onChange={(event) => setDraft(event.target.value)} />) ||
             <input value="fixed" onChange={submit} />;
         };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not use an unrelated dynamic input in another render region as an alternative", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, setDraft, showPreview }) => {
         if (showPreview) {
           const preview = <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
           void preview;
         }
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair an unrelated conditional state-driven return with a frozen fallback", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, mode, setDraft }) => {
         if (mode === "preview") {
           return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
         }
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair ternary results when the condition is unrelated to the dynamic value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, mode, setDraft }) => {
         return mode === "preview"
           ? <input value={draft} onChange={(event) => setDraft(event.target.value)} />
           : <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair a sibling member value with a guard on another property", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ form, setDraft }) => {
         if (form.other !== null) {
           return <input value={form.draft} onChange={(event) => setDraft(event.target.value)} />;
         }
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not pair a computed dynamic value through a matching callee name", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, format }) => {
         if (format !== null) {
           return <input value={format(draft)} onChange={submit} />;
         }
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("pairs a member value with a guard on its exact receiver", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ form, setDraft }) => {
         if (form !== null) {
           return <input value={form.draft} onChange={(event) => setDraft(event.target.value)} />;
         }
         return <input value="" onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not pair a shadowed condition reference with the outer dynamic value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft, mode, previewDraft, setDraft }) => {
         if (mode === "preview") {
           const draft = previewDraft;
           if (draft !== null) return <input value="fixed" onChange={submit} />;
         }
         return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an empty conditional return as a state-driven alternative", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ isHidden }) => {
         if (isHidden) return null;
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it.each(["readOnly", "disabled"])(
    "does not treat a static false %s prop as a read-only escape hatch",
    (attributeName) => {
      const result = runRule(
        noControlledInputValueWithoutStateUpdate,
        `<input value="fixed" ${attributeName}={false} onChange={submit} />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("recognizes a string-valued negative tabIndex as a hidden decoy signal", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `<input value="" tabIndex="-1" onChange={captureBotInput} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes any static negative tabIndex as an unfocusable decoy signal", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `<input value="" tabIndex={-2} onChange={captureBotInput} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["readOnly={null}", "disabled={void 0}"])(
    "does not treat static nullish %s as a read-only escape hatch",
    (attribute) => {
      const result = runRule(
        noControlledInputValueWithoutStateUpdate,
        `<input value="fixed" ${attribute} onChange={submit} />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not use a nested callback return as a state-driven component alternative", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const Field = ({ draft }) => {
         const renderPreview = () => <input value={draft} onChange={setDraft} />;
         if (showPreview) renderPreview();
         return <input value="fixed" onChange={submit} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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
