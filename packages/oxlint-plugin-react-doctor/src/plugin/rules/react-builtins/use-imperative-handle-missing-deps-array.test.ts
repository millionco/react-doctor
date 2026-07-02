import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { useImperativeHandleMissingDepsArray } from "./use-imperative-handle-missing-deps-array.js";

describe("use-imperative-handle-missing-deps-array", () => {
  it("flags a two-arg call whose handle captures a prop", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({
           submit: () => props.onSubmit(),
         }));
         return null;
       });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a React.useImperativeHandle member call capturing a state value", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `function Editor(props, ref) {
         const [value, setValue] = useState("");
         React.useImperativeHandle(ref, function () {
           return { getValue: () => value };
         });
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a named createHandle function that captures a prop", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         const createHandle = () => ({ submit: () => props.onSubmit() });
         useImperativeHandle(ref, createHandle);
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a dependency array is present", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({ submit: () => props.onSubmit() }), [props.onSubmit]);
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an empty dependency array is present", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({ submit: () => props.onSubmit() }), []);
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref-only handle (the focus idiom)", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, useRef } from "react";
       const Field = forwardRef((props, ref) => {
         const inputRef = useRef(null);
         useImperativeHandle(ref, () => ({
           focus: () => inputRef.current.focus(),
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally-shadowed useImperativeHandle", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `function useImperativeHandle(ref, create) {
         return create();
       }
       function Field(props) {
         useImperativeHandle(ref, () => ({ submit: () => props.onSubmit() }));
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-argument call", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref);
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the second argument is not a function", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref, handleObject);
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a handle-method parameter shadows a prop name (setValue setter idiom)", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, useRef } from "react";
       const Field = forwardRef(({ value }, ref) => {
         const inputRef = useRef(null);
         useImperativeHandle(ref, () => ({
           setValue: (value) => { inputRef.current.value = value; },
           focus: () => inputRef.current.focus(),
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a handle-method local destructure shadows a state name (ref-snapshot idiom)", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, useRef, useState } from "react";
       const Field = forwardRef((props, ref) => {
         const [value, setValue] = useState("");
         const stateRef = useRef({ value: "" });
         useImperativeHandle(ref, () => ({
           getValue: () => { const { value } = stateRef.current; return value; },
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref-only handle whose object key is named like a prop (exposed-ref idiom)", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, useRef } from "react";
       const Field = forwardRef(({ value }, ref) => {
         const inputRef = useRef(null);
         useImperativeHandle(ref, () => ({
           value: inputRef.current,
           focus: () => inputRef.current.focus(),
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside test/spec harness files (vitest imperative-handle harness idiom)", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle } from "react";
       const Harness = forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({
           updateProps: () => props.onUpdate(),
         }));
         return null;
       });`,
      { filename: "src/TextMask.spec.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a shorthand object property that captures a state value", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, useState } from "react";
       const Field = forwardRef((props, ref) => {
         const [value, setValue] = useState("");
         useImperativeHandle(ref, () => ({ value }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an anonymous default-exported forwardRef component", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `import { useImperativeHandle, forwardRef } from "react";
       export default forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({
           submit: () => props.onSubmit(),
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a CommonJS destructured require of the hook", () => {
    const result = runRule(
      useImperativeHandleMissingDepsArray,
      `const { useImperativeHandle, forwardRef } = require("react");
       const Field = forwardRef((props, ref) => {
         useImperativeHandle(ref, () => ({
           submit: () => props.onSubmit(),
         }));
         return null;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
