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
});
