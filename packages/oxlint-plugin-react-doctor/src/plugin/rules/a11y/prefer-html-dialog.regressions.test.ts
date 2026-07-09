import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferHtmlDialog } from "./prefer-html-dialog.js";

describe("a11y/prefer-html-dialog regressions", () => {
  it('does not claim focus trapping for a non-modal `role="dialog"` (no aria-modal)', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" aria-label="hi" />`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("focus trapping");
    expect(result.diagnostics[0].message).not.toContain("tab out");
  });

  it("does not flag a custom web component `<ui-modal>`", () => {
    const result = runRule(preferHtmlDialog, `<ui-modal role="dialog" />`);
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a modal `<div role="dialog" aria-modal="true">` with the focus-trap message', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" aria-modal="true" />`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("focus trapping");
  });

  it('still flags a bare `<div role="dialog">`', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" />`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a modal that traps focus via a useFocusTrap hook", () => {
    const source = `
      const Modal = ({ isOpen, onClose, children }) => {
        const modalRef = useFocusTrap({ isActive: isOpen, onEscape: onClose });
        return (
          <div ref={modalRef} role="dialog" aria-modal="true">
            {children}
          </div>
        );
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a modal wrapped in a focus-trap library component", () => {
    const source = `
      import FocusTrap from "focus-trap-react";
      const Modal = ({ children }) => (
        <FocusTrap>
          <div role="dialog" aria-modal="true">{children}</div>
        </FocusTrap>
      );
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a modal with a manual Tab-key focus trap", () => {
    const source = `
      const Modal = ({ onClose, children }) => {
        const handleKeyDown = (event) => {
          if (event.key === "Tab") {
            wrapFocusWithinModal(event);
          }
          if (event.key === "Escape") onClose();
        };
        return (
          <div role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
            {children}
          </div>
        );
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag dialog mocks in testlike files", () => {
    const result = runRule(preferHtmlDialog, `const Mock = () => <div role="dialog" />;`, {
      filename: "src/components/settings-dialog.test.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a modal whose file has no focus-trapping signal", () => {
    const source = `
      const Modal = ({ onClose, children }) => (
        <div role="dialog" aria-modal="true" onClick={onClose}>
          {children}
        </div>
      );
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still flags `aria-modal="true"` without role in a file with no trap signal', () => {
    const result = runRule(preferHtmlDialog, `<div aria-modal="true" />`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still flags a modal in a file with an unrelated "trap"-containing identifier', () => {
    const source = `
      const trapezoidArea = (a, b, height) => ((a + b) / 2) * height;
      const Modal = ({ children }) => (
        <div role="dialog" aria-modal="true">{children}</div>
      );
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still flags a modal in a file with a bare "Tab" string (tab-bar label)', () => {
    const source = `
      const labels = ["Tab", "Settings"];
      const Modal = ({ children }) => (
        <div role="dialog" aria-modal="true">{children}</div>
      );
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still suppresses via a trapFocus helper identifier", () => {
    const source = `
      const Modal = ({ children }) => {
        useEffect(() => trapFocus(ref.current), []);
        return <div role="dialog" aria-modal="true">{children}</div>;
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toEqual([]);
  });

  // Delta-verify recall regression (bulwarkmail email-composer): the file's
  // useFocusTrap refs are wired to OTHER dialogs, so a dialog that attaches
  // none of them can still leak focus — the trap suppression must be scoped
  // to the element, not the file.
  it("still flags a dialog whose file's focus-trap refs are attached to a different dialog", () => {
    const source = `
      const Composer = () => {
        const saveTemplateModalRef = useFocusTrap({ isActive: showSave, onEscape: close });
        return (
          <>
            <div ref={saveTemplateModalRef} role="dialog" aria-modal="true">save as template</div>
            <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <input type="password" onKeyDown={(e) => { if (e.key === "Enter") resolve(); }} />
            </div>
          </>
        );
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("focus trapping");
  });

  it("suppresses a dialog whose trap ref sits on an ancestor wrapper", () => {
    const source = `
      const Modal = ({ children }) => {
        const overlayRef = useFocusTrap({ isActive: true });
        return (
          <div ref={overlayRef} className="overlay">
            <div role="dialog" aria-modal="true">{children}</div>
          </div>
        );
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("suppresses a dialog that references a named Tab-trapping handler while a sibling without one is flagged", () => {
    const source = `
      const Dialogs = () => {
        const handleTrapKeyDown = (event) => {
          if (event.key === "Tab") wrapFocus(event);
        };
        return (
          <>
            <div role="dialog" aria-modal="true" onKeyDown={handleTrapKeyDown}>trapped</div>
            <div role="dialog" aria-modal="true">untrapped</div>
          </>
        );
      };
    `;
    const result = runRule(preferHtmlDialog, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary role whose branches are both dialog roles", () => {
    const result = runRule(
      preferHtmlDialog,
      `const M = ({ isAlert, children }) => (
        <div role={isAlert ? "alertdialog" : "dialog"}>{children}</div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const-bound dialog role", () => {
    const result = runRule(
      preferHtmlDialog,
      `const modalRole = "dialog";
const M = ({ children }) => <div role={modalRole}>{children}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary role with a non-dialog branch", () => {
    const result = runRule(
      preferHtmlDialog,
      `const M = ({ open, children }) => (
        <div role={open ? "dialog" : "presentation"}>{children}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role resolved from a parameter", () => {
    const result = runRule(
      preferHtmlDialog,
      `const M = ({ overlayRole, children }) => <div role={overlayRole}>{children}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
