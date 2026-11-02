import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change global document focus", () => {
  it.each([
    "global.document.getElementById(inputId)?.focus()",
    "global.document.querySelector(inputId)?.focus()",
    'global["document"].querySelector(inputId)?.focus()',
    "globalThis.document.querySelector(inputId)?.focus()",
  ])("allows the focus acknowledgment after %s", (focusCall) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      import { useEffect, useState } from "react";
      const Field = ({ inputId }) => {
        const [needsFocus, setNeedsFocus] = useState(false);
        useEffect(() => {
          if (needsFocus) {
            ${focusCall};
            setNeedsFocus(false);
          }
        }, [inputId, needsFocus]);
        return <button onClick={() => setNeedsFocus(true)}>Focus input</button>;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["({ inputId, global })", "({ inputId, globalThis: global })"])(
    "keeps warnings when the global receiver is a parameter %s",
    (parameters) => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `
      import { useEffect, useState } from "react";
      const Field = ${parameters} => {
        const [needsFocus, setNeedsFocus] = useState(false);
        useEffect(() => {
          if (needsFocus) {
            global.document.querySelector(inputId)?.focus();
            setNeedsFocus(false);
          }
        }, [inputId, needsFocus]);
        return <button onClick={() => setNeedsFocus(true)}>Focus input</button>;
      };
    `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    "global.service.querySelector(inputId)?.focus()",
    "global[documentName].querySelector(inputId)?.focus()",
  ])("keeps warnings for unproven DOM receivers %s", (focusCall) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      import { useEffect, useState } from "react";
      const Field = ({ inputId, documentName }) => {
        const [needsFocus, setNeedsFocus] = useState(false);
        useEffect(() => {
          if (needsFocus) {
            ${focusCall};
            setNeedsFocus(false);
          }
        }, [inputId, needsFocus]);
        return <button onClick={() => setNeedsFocus(true)}>Focus input</button>;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps an unrelated prop reset before global DOM focus", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      import { useEffect, useState } from "react";
      const Field = ({ inputId, itemId }) => {
        const [value, setValue] = useState("");
        useEffect(() => {
          setValue("");
          global.document.getElementById(inputId)?.focus();
        }, [inputId, itemId]);
        return <input value={value} onChange={event => setValue(event.target.value)} />;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
