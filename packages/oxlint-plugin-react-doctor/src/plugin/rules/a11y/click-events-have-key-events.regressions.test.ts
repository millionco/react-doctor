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
});
