import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInRender } from "./no-prop-callback-in-render.js";

const run = (code: string) => runRule(noPropCallbackInRender, code);

describe("no-prop-callback-in-render", () => {
  it.each([
    [
      "a ref-guarded error notification",
      `import { useRef } from "react";
       const Image = ({ error, onError }) => {
         const notifiedErrorRef = useRef();
         if (error && error !== notifiedErrorRef.current) {
           notifiedErrorRef.current = error;
           onError?.(error);
         }
         return null;
       };`,
    ],
    [
      "a callback on the whole props object",
      `function Image(props) {
         if (props.error) props.onError(props.error);
         return null;
       }`,
    ],
    [
      "an immutable callback alias",
      `const Image = ({ error, onError }) => {
         const notifyError = onError;
         if (error) notifyError(error);
         return null;
       };`,
    ],
    [
      "an IIFE that executes while rendering",
      `const Image = ({ error, onError }) => {
         (() => { if (error) onError(error); })();
         return null;
       };`,
    ],
    [
      "a synchronous iteration callback",
      `const List = ({ items, onVisit }) => {
         items.forEach((item) => { onVisit(item); });
         return null;
       };`,
    ],
    [
      "a custom hook callback",
      `const useNotifyError = (error, onError) => {
         if (error) onError(error);
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a rendered callback result",
      `const List = ({ item, renderItem }) => <div>{renderItem(item)}</div>;`,
    ],
    [
      "a returned callback result",
      `const Panel = ({ value, selectView }) => { return selectView(value); };`,
    ],
    [
      "a locally consumed callback result",
      `const Form = ({ value, validate }) => {
         const validation = validate(value);
         return <output>{validation}</output>;
       };`,
    ],
    [
      "an event handler",
      `const Button = ({ onSave }) => <button onClick={() => onSave()}>Save</button>;`,
    ],
    [
      "an effect",
      `import { useEffect } from "react";
       const Image = ({ error, onError }) => {
         useEffect(() => { if (error) onError(error); }, [error, onError]);
         return null;
       };`,
    ],
    [
      "a deferred callback",
      `const Image = ({ error, onError }) => {
         if (error) queueMicrotask(() => onError(error));
         return null;
       };`,
    ],
    [
      "a useMemo value producer",
      `import { useMemo } from "react";
       const Panel = ({ value, computeValue }) => {
         const result = useMemo(() => computeValue(value), [computeValue, value]);
         return <output>{result}</output>;
       };`,
    ],
    [
      "a shadowed callback name",
      `const Image = ({ error, onError }) => {
         const notify = (onError) => { if (error) onError(error); };
         return notify(() => {});
       };`,
    ],
    [
      "a data method on a destructured prop",
      `const List = ({ items }) => {
         items.forEach((item) => { item.validate(); });
         return null;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
