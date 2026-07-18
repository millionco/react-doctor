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

  it("still flags when a composition-start handler does not guard the Enter action", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input
           onCompositionStart={() => log()}
           onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
         />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags an Enter commit that runs only while composition is active", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(event) => {
           if (event.key === "Enter" && event.nativeEvent.isComposing) save();
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nested Enter commit that runs only while composition is active", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(event) => {
           if (event.key === "Enter") {
             if (event.nativeEvent.isComposing) save();
           }
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a nested logical gate requires composition to be inactive", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(event) => {
           if (event.key === "Enter") {
             !event.nativeEvent.isComposing && save();
           }
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an Enter commit after an inverted composition early return", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(event) => {
           if (!event.nativeEvent.isComposing) return;
           if (event.key === "Enter") save();
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Enter when a modifier is only an alternative trigger", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <textarea onKeyDown={(event) => {
           if (event.key === "Enter" || event.metaKey) save();
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags without crashing when a modifier helper recursively calls itself", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => {
         const requiresModifier = () => requiresModifier();
         return <textarea onKeyDown={(event) => {
           if (event.key === "Enter" && requiresModifier()) save();
         }} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a static false readOnly prop as non-editable", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input readOnly={false} onKeyDown={(event) => {
           if (event.key === "Enter") save();
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when an Enter branch only logs diagnostic information", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = () => (
         <input onKeyDown={(event) => {
           if (event.key === "Enter") console.log(event.currentTarget.value);
         }} />
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a shadowed console logger as non-committing", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = ({ save }) => {
         const console = { log: save };
         return <input onKeyDown={(event) => {
           if (event.key === "Enter") console.log();
         }} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["readOnly={null}", "disabled={void 0}"])(
    "does not treat static nullish %s as non-editable",
    (attribute) => {
      const result = runRule(
        noEnterSubmitWithoutImeCompositionGuard,
        `<input ${attribute} onKeyDown={(event) => {
           if (event.key === "Enter") save();
         }} />`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

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

  it("still flags when a helper checks composition only after committing", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Field = ({ isComposing, onSave }) => {
         const commitEdit = () => {
           onSave();
           if (isComposing) return;
         };
         return <input onKeyDown={(event) => { if (event.key === "Enter") commitEdit(); }} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("stays quiet when the modifier gate is extracted into a same-file helper", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const isModEnter = (event) => event.metaKey || event.ctrlKey;
       const Composer = ({ send }) => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter' && isModEnter(e)) send(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a password field with a reveal toggle (dynamic type)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const PasswordField = ({ showPassword, handleLogin }) => (
         <input
           type={showPassword ? 'text' : 'password'}
           onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an extracted named onChange handler coerces the value numerically", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const MaxDimension = ({ update, save }) => {
         const handleChange = (e) => {
           update(parseInt(e.target.value, 10));
         };
         return (
           <input
             onChange={handleChange}
             onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
           />
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an inline onChange coerces the value with unary plus", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const PriceField = ({ setPrice, applyPrice }) => (
         <input
           onChange={(e) => setPrice(+e.target.value)}
           onKeyDown={(e) => { if (e.key === 'Enter') applyPrice(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a contentEditable={false} atomic embed activating on Enter", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const EmbedBlock = ({ onActivate, children }) => (
         <div
           contentEditable={false}
           tabIndex={0}
           onKeyDown={(e) => {
             if (e.key === 'Enter') {
               e.preventDefault();
               onActivate();
             }
           }}
         >
           {children}
         </div>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('stays quiet on a type="tel" phone field', () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const PhoneField = ({ onSubmit }) => (
         <input type="tel" onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when keyCode 229 is compared against a named module constant", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const IME_PROCESS_KEYCODE = 229;
       const TagInput = ({ addTag }) => (
         <input
           onKeyDown={(e) => {
             if (e.keyCode === IME_PROCESS_KEYCODE) return;
             if (e.key === 'Enter') addTag(e.target.value);
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a same-file IME hook wires composition via spread bind", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const useImeGuard = () => {
         const activeRef = useRef(false);
         return {
           bind: {
             onCompositionStart: () => { activeRef.current = true; },
             onCompositionEnd: () => { activeRef.current = false; },
           },
           isActive: () => activeRef.current,
         };
       };
       const TitleField = ({ onSave }) => {
         const ime = useImeGuard();
         return (
           <input
             {...ime.bind}
             onKeyDown={(e) => { if (e.key === 'Enter' && !ime.isActive()) onSave(); }}
           />
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a class component delegates Enter to a guarded instance method", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `class TagInput extends React.Component {
         commitEntry = (e) => {
           if (e.nativeEvent.isComposing) return;
           this.props.onAdd(e.target.value);
         };
         render() {
           return (
             <input onKeyDown={(e) => { if (e.key === 'Enter') this.commitEntry(e); }} />
           );
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an imported IME-event helper guards the Enter branch", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `import { isImeKeyEvent } from '../utils/keyboard';
       const SearchField = ({ onSearch }) => (
         <input
           onKeyDown={(e) => {
             if (isImeKeyEvent(e)) return;
             if (e.key === 'Enter') onSearch(e.target.value);
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a digits-only field enforced by a regex strip in onChange", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const QuantityField = ({ setQuantity, commit }) => (
         <input
           onChange={(e) => setQuantity(e.target.value.replace(/\\D/g, ''))}
           onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a plain Enter submit whose helper checks no modifier", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const normalize = (value) => value.trim();
       const CommentBox = ({ submit }) => (
         <textarea onKeyDown={(e) => { if (e.key === 'Enter') submit(normalize(e.target.value)); }} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a validity-gated Enter commit (validation gates are not composition guards)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const CalendarNameField = ({ isValid, onSave, name }) => (
         <input
           type="text"
           onKeyDown={(e) => { if (e.key === 'Enter' && isValid) onSave(name); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an error-state-gated Enter commit (bulwarkmail sub-address accepted-noise shape)", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const TagField = ({ tag, error, handleUseAddress }) => (
         <input
           type="text"
           onKeyDown={(e) => {
             if (e.key === 'Enter' && tag && !error) {
               e.preventDefault();
               handleUseAddress();
             }
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a timer-named handler despite containing the letters i-m-e", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const TimeField = ({ setTimer, commitTime }) => (
         <input
           onChange={(e) => setTimer(e.target.value)}
           onKeyDown={(e) => { if (e.key === 'Enter') commitTime(); }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an extracted named Enter handler", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Editor = () => {
         const handleKeyDown = (event) => { if (event.key === "Enter") save(); };
         return <input onKeyDown={handleKeyDown} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a deferred nested callback declaration as an immediate commit", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Editor = () => <input onKeyDown={(event) => {
         if (event.key === "Enter") {
           const commitLater = () => save();
           void commitLater;
         }
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an Enter branch inside a deferred callback as the handler", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Editor = () => <input onKeyDown={() => {
         const handleLater = (event) => {
           if (event.key === "Enter") save();
         };
         void handleLater;
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an unrelated composition-named value as a guard", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Editor = () => <input onKeyDown={(event) => {
         const compositionLabel = "editor";
         if (event.key === "Enter") save(compositionLabel);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unrelated composition branch as protection for Enter", () => {
    const result = runRule(
      noEnterSubmitWithoutImeCompositionGuard,
      `const Editor = () => <input onKeyDown={(event) => {
         if (event.nativeEvent.isComposing) trackComposition();
         if (event.key === "Enter") save();
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
