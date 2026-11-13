import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

for (const rule of [noImpureStateUpdater, noSideEffectInStateUpdaterFunction]) {
  describe(`${rule.id} object URL operations`, () => {
    it.each([
      "URL.createObjectURL(new Blob())",
      "URL.revokeObjectURL(previous)",
      "window.URL.createObjectURL(new Blob())",
      "globalThis.URL.revokeObjectURL(previous)",
      "self.URL.revokeObjectURL(previous)",
      '(URL as typeof URL)["revokeObjectURL"](previous)',
      '(window["URL"]).createObjectURL(new Blob())',
      "(URL.revokeObjectURL)(previous)",
    ])("reports %s in an updater", (operation) => {
      const code = `import { useState as useValue } from "react";
        function Preview() {
          const [value, setValue] = useValue("");
          const update = () => setValue(previous => {
            ${operation};
            return "";
          });
          return <button onClick={update}>{value}</button>;
        }`;
      expect(runRule(rule, code).diagnostics).toHaveLength(1);
    });

    it.each(["URL", "window", "globalThis", "self"])(
      "preserves a shadowed %s receiver",
      (receiver) => {
        const operation = receiver === "URL" ? "URL" : `${receiver}.URL`;
        const code = `import { useState } from "react";
        function Preview({ ${receiver} }) {
          const [value, setValue] = useState("");
          const update = () => setValue(previous => {
            ${operation}.revokeObjectURL(previous);
            return "";
          });
          return <button onClick={update}>{value}</button>;
        }`;
        expect(runRule(rule, code).diagnostics).toHaveLength(0);
      },
    );

    it.each([
      "const URL = { revokeObjectURL(value) { return value; } }; URL.revokeObjectURL(previous);",
      "const unused = () => URL.revokeObjectURL(previous);",
      "const later = async () => URL.createObjectURL(new Blob());",
      "return () => URL.revokeObjectURL(previous);",
      "window.service.URL.revokeObjectURL(previous);",
      "URL[method](previous);",
      "URL.canParse(previous);",
    ])("preserves unsupported or pure operations: %s", (operation) => {
      expect(
        runRule(
          rule,
          `import { useState } from "react";
        function Preview({ method }) {
          const [value, setValue] = useState("");
          const update = () => setValue(previous => {
            ${operation}
            return "";
          });
          return <button onClick={update}>{value}</button>;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });

    it("preserves event-owned creation and effect cleanup", () => {
      expect(
        runRule(
          rule,
          `import { useEffect, useState } from "react";
        function Preview() {
          const [value, setValue] = useState("");
          useEffect(() => () => URL.revokeObjectURL(value), [value]);
          const update = () => {
            const next = URL.createObjectURL(new Blob());
            setValue(() => next);
          };
          return <button onClick={update}>{value}</button>;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });

    it("does not mistake an ordinary function for a state setter", () => {
      expect(
        runRule(
          rule,
          `const setValue = callback => callback("");
        setValue(previous => URL.revokeObjectURL(previous));`,
        ).diagnostics,
      ).toHaveLength(0);
    });
  });
}
