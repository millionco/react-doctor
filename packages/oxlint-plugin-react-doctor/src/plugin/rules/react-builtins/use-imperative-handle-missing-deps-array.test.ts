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
});
