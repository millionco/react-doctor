import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEnterSubmitWithoutImeCompositionGuard } from "./no-enter-submit-without-ime-composition-guard.js";

describe("no-enter-submit-without-ime-composition-guard", () => {
  it("flags an input Enter-to-commit with no composition guard", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const EventTitle = ({ onSave }) => (
         <input
           onKeyDown={(e) => {
             if (e.key === 'Enter') onSave();
           }}
         />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a role=textbox contentEditable committing on Enter", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Tags = ({ value }) => (
         <div
           role="textbox"
           contentEditable
           onKeyDown={(e) => {
             if (e.key === 'Enter') {
               e.preventDefault();
               commitTag(value);
             }
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a textarea keyCode 13 submit", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Box = () => (
         <textarea
           onKeyDown={(e) => {
             if (e.keyCode === 13) submitDialog();
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the logical && submit shape", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(e) => { e.key === 'Enter' && onSave(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a role=radio activation handler", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Rating = ({ rating }) => (
         <div role="radio" onKeyDown={(e) => { if (e.key === 'Enter') selectValue(rating); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a role=button Space+Enter activation", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Btn = () => (
         <div role="button" onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onActivate(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a modifier-gated Cmd/Ctrl+Enter submit", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Composer = () => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when composition state is tracked in the component", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = ({ isComposing, setComposing }) => (
         <input
           onCompositionStart={() => setComposing(true)}
           onCompositionEnd={() => setComposing(false)}
           onKeyDown={(e) => {
             if (e.key === 'Enter' && !isComposing) onSave();
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the handler bails on nativeEvent.isComposing", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(e) => {
           if (e.nativeEvent.isComposing) return;
           if (e.key === 'Enter') onSave();
         }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a type=checkbox input", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Check = () => (
         <input type="checkbox" onKeyDown={(e) => { if (e.key === 'Enter') toggle(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a textarea Space+Enter activation", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Box = () => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activate(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a type=number field where IME composition cannot commit (time-picker idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const TimePicker = ({ commit }) => (
         <input type="number" onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an inputMode=numeric text field (numeric-semantics idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const PxField = ({ apply }) => (
         <input inputMode="numeric" onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when onChange coerces the value with Number() (seat-stepper idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const SeatStepper = ({ setSeats, confirm }) => (
         <input
           onChange={(e) => setSeats(Number(e.target.value))}
           onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when onChange coerces the value with parseInt (max-dimension option idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const MaxDimension = ({ update, save }) => (
         <input
           onChange={(e) => { update(parseInt(e.target.value, 10)); }}
           onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an Enter handler that only calls preventDefault (implicit-submit blocker idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an Enter handler that only stops propagation", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a readOnly input trigger (date-picker/combobox idiom)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const DateField = ({ openCalendar }) => (
         <input readOnly onKeyDown={(e) => { if (e.key === 'Enter') openCalendar(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a type=password Enter-to-login field", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Login = ({ handleLogin }) => (
         <input type="password" onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the chat-composer send-on-Enter with a negated Shift gate", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Chat = ({ send }) => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unguarded Enter-commit even when nearby names contain 'composer'", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const ChatComposer = ({ composerText, onSend }) => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter') onSend(composerText); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unguarded field even when a sibling control has composition wiring", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Form = ({ isComposing, setComposing, saveTitle, saveNote }) => (
         <form>
           <input
             onCompositionStart={() => setComposing(true)}
             onCompositionEnd={() => setComposing(false)}
             onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing) saveTitle(); }}
           />
           <input onKeyDown={(e) => { if (e.key === 'Enter') saveNote(); }} />
         </form>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the composition guard lives inside the called commit helper", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = ({ isComposingRef, onSave }) => {
         const commitEdit = () => {
           if (isComposingRef.current) return;
           onSave();
         };
         return <input onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the guard sits two helper hops below the handler", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = ({ isComposingRef, onSave }) => {
         const guardedCommit = () => {
           if (isComposingRef.current) return;
           onSave();
         };
         const submitDraft = () => guardedCommit();
         return <input onKeyDown={(e) => { if (e.key === 'Enter') submitDraft(); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
