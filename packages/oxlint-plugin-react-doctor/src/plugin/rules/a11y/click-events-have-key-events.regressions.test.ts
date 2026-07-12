import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

describe("a11y/click-events-have-key-events regressions", () => {
  it("does not flag a label wrapping a native checkbox", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const A = ({ toggle, checked }) => (
        <label onClick={toggle}>
          <input type="checkbox" checked={checked} readOnly />
          Enable
        </label>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an inline focus-forwarding click handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const A = ({ inputRef }) => <div onClick={() => inputRef.current?.focus()} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a named same-file propagation-guard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const stopEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      export const A = () => <div onClick={stopEvent} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a click handler that forwards clicks to a hidden file input", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const A = ({ fileInputRef }) => (
        <div onClick={() => fileInputRef.current?.click()} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a tr with a click handler and no keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Row = ({ select }) => <tr onClick={select} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a clickable canvas with no keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Graph = ({ openNode }) => <canvas onClick={openNode} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a tr that also has a keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Row = ({ select, onKeyDown }) => <tr onClick={select} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a motion.div with a click handler and no keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `import { motion } from "framer-motion";
      export const Backdrop = ({ onClose }) => <motion.div onClick={onClose} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a motion.div with a keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `import { motion } from "framer-motion";
      export const A = ({ onClick, onKeyDown }) => <motion.div onClick={onClick} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a non-DOM member-expression component", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const A = ({ onClick }) => <Styled.Card onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a div spreading react-aria buttonProps", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const CalendarCell = ({ buttonProps, navigate }) => (
        <div {...buttonProps} onClick={navigate} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["an inline object", `export const Card = ({ open }) => <div {...{ onClick: open }} />;`],
    [
      "a local object",
      `export const Card = ({ open }) => {
        const cardProps = { className: "card", onClick: open };
        return <div {...cardProps} />;
      };`,
    ],
    [
      "a static computed key",
      `export const Card = ({ open }) => <div {...{ ["onClick"]: open }} />;`,
    ],
  ])("flags a noninteractive element whose click handler comes from %s", (_name, code) => {
    const result = runRule(clickEventsHaveKeyEvents, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a transparent spread that includes a keyboard handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Card = ({ open, openFromKeyboard }) => (
        <div {...{ onClick: open, onKeyDown: openFromKeyboard }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags repeated transparent spreads of the same click props object", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Card = ({ open }) => {
        const cardProps = { onClick: open };
        return <div {...cardProps} {...cardProps} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an inline focus-forwarding handler inside a transparent spread", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Field = ({ inputRef }) => (
        <div {...{ onClick: () => inputRef.current?.focus() }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a named backdrop handler inside a transparent spread", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Modal = ({ close }) => {
        const dismissBackdrop = (event) => {
          if (event.target === event.currentTarget) close();
        };
        return <div {...{ onClick: dismissBackdrop }} />;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a native button whose click handler comes from a transparent spread", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Card = ({ open }) => <button {...{ onClick: open }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a spread role conservative when it can change accessibility semantics", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Option = ({ select }) => (
        <div {...{ role: "option", onClick: select }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role=option item of a listbox composite", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Option = ({ selected, select, children }) => (
        <div className="option" role="option" aria-selected={selected} onClick={select}>
          {children}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a hover-highlighted suggestion list item", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Suggestion = ({ index, setSelection, handleSelection, item }) => (
        <li
          onMouseEnter={() => setSelection(index)}
          onClick={() => handleSelection(index)}
        >
          {item}
        </li>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a backdrop dismiss handler gated on target === currentTarget", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Modal = ({ close }) => {
        const handleBackdropClick = (e) => {
          if (e.target === e.currentTarget) {
            close();
          }
        };
        return <div role="dialog" className="backdrop" onClick={handleBackdropClick} />;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a wrapper li bubbling clicks from an inner nav link", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Category = ({ item, path, setIsDocsNavOpen }) => (
        <li onClick={() => setIsDocsNavOpen(false)}>
          <NavItem item={item} path={path} />
        </li>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a clickable cell wrapping an edit Button", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const EditableCell = ({ setOpen, children }) => (
        <div className="editable-cell" onClick={() => setOpen(true)}>
          <span>{children}</span>
          <Button aria-label="edit">Edit</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a plain clickable div with static content", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Card = ({ open }) => (
        <div className="card" onClick={open}>
          <span>Details</span>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // FN mining: click affordances the onClick-only lookup missed.
  it("flags a capture-phase-only click handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Cell = ({ id }) => <div onClickCapture={() => selectRow(id)}>Open</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag onClickCapture paired with a capture-phase key handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Cell = ({ id }) => (
        <div onClickCapture={() => selectRow(id)} onKeyDownCapture={() => selectRow(id)}>Open</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a styled.div member element with onClick and no key handler", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Cell = ({ id }) => <styled.div onClick={() => selectRow(id)}>Open</styled.div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag styled.button — the underlying tag is interactive", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Cell = ({ id }) => <styled.button onClick={() => selectRow(id)}>Open</styled.button>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
