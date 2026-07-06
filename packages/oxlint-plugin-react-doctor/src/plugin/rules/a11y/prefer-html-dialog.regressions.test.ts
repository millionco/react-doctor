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
});
