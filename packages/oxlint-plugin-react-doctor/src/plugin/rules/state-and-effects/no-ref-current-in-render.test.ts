import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const run = (code: string) => runRule(noRefCurrentInRender, code);

describe("no-ref-current-in-render", () => {
  it.each([
    [
      "a latest-value ref",
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const latestValueRef = useRef(value);
         latestValueRef.current = value;
         return null;
       };`,
    ],
    [
      "a ref alias",
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(value);
         const alias = valueRef;
         alias.current = value;
         return null;
       };`,
    ],
    [
      "a generic ref behind a TypeScript cast",
      `import { useRef } from "react";
       const Panel = ({ value }: { value: string }) => {
         const valueRef = useRef<string>(value) as React.MutableRefObject<string>;
         valueRef.current = value;
         return null;
       };`,
    ],
    [
      "a generic ref behind a non-null assertion",
      `import { useRef } from "react";
       const Panel = ({ value }: { value: string }) => {
         const valueRef = useRef<string>(value)!;
         valueRef.current = value;
         return null;
       };`,
    ],
    [
      "a write through a typed ref receiver",
      `import { useRef } from "react";
       const Panel = ({ value }: { value: string }) => {
         const valueRef = useRef<string>(value);
         (valueRef as React.MutableRefObject<string>).current = value;
         return null;
       };`,
    ],
    [
      "a write through a non-null ref receiver",
      `import { useRef } from "react";
       const Panel = ({ value }: { value: string }) => {
         const valueRef = useRef<string>(value);
         valueRef!.current = value;
         return null;
       };`,
    ],
    [
      "a ref guard used to drive state",
      `import { useRef, useState } from "react";
       const Panel = ({ value }) => {
         const previousValueRef = useRef(value);
         const [selected, setSelected] = useState(value);
         if (previousValueRef.current !== value) {
           previousValueRef.current = value;
           setSelected(value);
         }
         return <output>{selected}</output>;
       };`,
    ],
    [
      "an increment",
      `import * as React from "react";
       const Panel = () => {
         const renderCountRef = React.useRef(0);
         renderCountRef.current++;
         return null;
       };`,
    ],
    [
      "a replacement in the null guard alternate",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         if (playerRef.current === null) {
           preparePlayer();
         } else {
           playerRef.current = new VideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "an IIFE executed during render",
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(value);
         (() => { valueRef.current = value; })();
         return null;
       };`,
    ],
    [
      "a synchronous iteration callback",
      `import { useRef } from "react";
       const List = ({ items }) => {
         const itemRef = useRef(null);
         items.forEach((item) => { itemRef.current = item; });
         return null;
       };`,
    ],
    [
      "a custom hook",
      `import { useRef } from "react";
       const useLatest = (value) => {
         const latestValueRef = useRef(value);
         latestValueRef.current = value;
         return latestValueRef;
       };`,
    ],
    [
      "a repeated write under a null guard",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) {
           valueRef.current = firstValue();
           valueRef.current = secondValue();
         }
         return null;
       };`,
    ],
    [
      "a write in a loop under a null guard",
      `import { useRef } from "react";
       const Panel = ({ values }) => {
         const valueRef = useRef(null);
         if (valueRef.current === null) {
           for (const value of values) valueRef.current = value;
         }
         return null;
       };`,
    ],
    [
      "a statically computed current write",
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         valueRef["current"] = value;
         return null;
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "the documented lazy initialization pattern",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         if (playerRef.current === null) {
           playerRef.current = new VideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "documented lazy initialization behind a nested wrapper",
      `import { useRef } from "react";
       const Video = ({ shouldInitialize }) => {
         const playerRef = useRef(null);
         if (playerRef.current === null) {
           if (shouldInitialize) {
             playerRef.current = new VideoPlayer();
           }
         }
         return <video />;
       };`,
    ],
    [
      "documented lazy initialization with wrapped receivers",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef<VideoPlayer | null>(null);
         if ((playerRef as React.MutableRefObject<VideoPlayer | null>).current === null) {
           playerRef!.current = new VideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "lazy initialization from a factory",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         if (playerRef.current === null) {
           playerRef.current = createVideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "lazy initialization with an undefined sentinel",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef();
         if (playerRef.current === undefined) {
           playerRef.current = createVideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "lazy initialization in an inequality alternate",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         if (playerRef.current !== null) {
           preparePlayer(playerRef.current);
         } else {
           playerRef.current = createVideoPlayer();
         }
         return <video />;
       };`,
    ],
    [
      "lazy initialization with nullish assignment",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         playerRef.current ??= createVideoPlayer();
         return <video />;
       };`,
    ],
    [
      "lazy initialization with logical-or assignment",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         playerRef.current ||= createVideoPlayer();
         return <video />;
       };`,
    ],
    [
      "lazy initialization through a const current alias",
      `import { useRef } from "react";
       const Video = () => {
         const playerRef = useRef(null);
         const player = playerRef.current;
         if (player === null) playerRef.current = createVideoPlayer();
         return <video />;
       };`,
    ],
    [
      "mutually exclusive lazy initialization writes",
      `import { useRef } from "react";
       const Video = ({ useHardware }) => {
         const playerRef = useRef(null);
         if (playerRef.current === null) {
           if (useHardware) playerRef.current = createHardwarePlayer();
           else playerRef.current = createSoftwarePlayer();
         }
         return <video />;
       };`,
    ],
    [
      "an event handler",
      `import { useRef } from "react";
       const Button = () => {
         const clickedRef = useRef(false);
         return <button onClick={() => { clickedRef.current = true; }}>Save</button>;
       };`,
    ],
    [
      "an effect",
      `import { useEffect, useRef } from "react";
       const Panel = ({ value }) => {
         const latestValueRef = useRef(value);
         useEffect(() => { latestValueRef.current = value; }, [value]);
         return null;
       };`,
    ],
    [
      "a ref callback",
      `import { useRef } from "react";
       const Input = () => {
         const inputRef = useRef(null);
         return <input ref={(node) => { inputRef.current = node; }} />;
       };`,
    ],
    [
      "a deferred callback",
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const latestValueRef = useRef(value);
         queueMicrotask(() => { latestValueRef.current = value; });
         return null;
       };`,
    ],
    [
      "a non-React current property",
      `const Panel = ({ value }) => {
         const cursor = { current: null };
         cursor.current = value;
         return null;
       };`,
    ],
    [
      "a userland useRef function",
      `const useRef = (value) => ({ current: value });
       const Panel = ({ value }) => {
         const valueRef = useRef(value);
         valueRef.current = value;
         return null;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
