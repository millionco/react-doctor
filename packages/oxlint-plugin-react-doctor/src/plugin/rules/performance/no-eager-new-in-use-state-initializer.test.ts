import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderLazyStateInit } from "../state-and-effects/rerender-lazy-state-init.js";
import { noEagerNewInUseStateInitializer } from "./no-eager-new-in-use-state-initializer.js";

const run = (code: string) => runRule(noEagerNewInUseStateInitializer, code);

describe("no-eager-new-in-use-state-initializer", () => {
  it.each([
    [
      "a named React import",
      `import { useState } from "react";
       import { AudioEngine } from "./audio-engine";
       export const Player = () => useState(new AudioEngine());`,
      "AudioEngine",
    ],
    [
      "an aliased named React import",
      `import { useState as useLocalState } from "react";
       export const Player = () => useLocalState(new AbortController());`,
      "AbortController",
    ],
    [
      "a default React namespace",
      `import React from "react";
       export const Player = () => React.useState(new Worker("worker.js"));`,
      "Worker",
    ],
    [
      "a namespace React import",
      `import * as ReactRuntime from "react";
       export const Player = () => ReactRuntime.useState(new WebSocket("/events"));`,
      "WebSocket",
    ],
    [
      "a const alias of useState",
      `import { useState } from "react";
       const useLocalState = useState;
       export const Player = () => useLocalState(new AudioContext());`,
      "AudioContext",
    ],
    [
      "a destructured React namespace",
      `import React from "react";
       const { useState: useLocalState } = React;
       export const Player = () => useLocalState(new BroadcastChannel("updates"));`,
      "BroadcastChannel",
    ],
    [
      "a conditional alias proven to be useState on both branches",
      `import { useState } from "react";
       const useLocalState = condition ? useState : useState;
       export const Player = () => useLocalState(new AudioContext());`,
      "AudioContext",
    ],
    [
      "a Preact hook import",
      `import { useState } from "preact/hooks";
       export const Player = () => useState(new EventSource("/events"));`,
      "EventSource",
    ],
  ])("reports eager construction through %s", (_name, code, constructorName) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(`new ${constructorName}()`);
  });

  it.each([
    [
      "a call-fed Map",
      `import { useState } from "react";
       export const Index = ({ items }) => useState(new Map(items.map((item) => [item.id, item])));`,
    ],
    [
      "a Map fed an unknown iterable",
      `import { useState } from "react";
       export const Index = ({ entries }) => useState(new Map(entries));`,
    ],
    [
      "a Date fed a runtime timestamp",
      `import { useState } from "react";
       export const Index = ({ timestamp }) => useState(new Date(timestamp));`,
    ],
    [
      "a Date fed a unary-wrapped runtime timestamp",
      `import { useState } from "react";
       export const Index = ({ timestamp }) => useState(new Date(+timestamp));`,
    ],
    [
      "an Array fed a runtime length",
      `import { useState } from "react";
       export const Index = ({ length }) => useState(new Array(length));`,
    ],
    [
      "a scalar constructor fed a call",
      `import { useState } from "react";
       export const Index = () => useState(new Object(buildValue()));`,
    ],
    [
      "a user-defined class named Map",
      `import { useState } from "react";
       class Map { constructor() { connect(); } }
       export const Index = () => useState(new Map());`,
    ],
    [
      "an imported constructor named Map",
      `import { useState } from "react";
       import { Map } from "immutable";
       export const Index = () => useState(new Map());`,
    ],
    [
      "a subclass of a cheap built-in",
      `import { useState } from "react";
       class IndexedMap extends Map {}
       export const Index = () => useState(new IndexedMap());`,
    ],
    [
      "a member-expression constructor",
      `import { useState } from "react";
       import * as models from "./models";
       export const Index = () => useState(new models.Map());`,
    ],
    [
      "a dynamic computed constructor",
      `import { useState } from "react";
       import * as models from "./models";
       export const Index = ({ kind }) => useState(new models[kind]());`,
    ],
  ])("does not grant global built-in exemptions to %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a conditional branch",
      `import { useState } from "react";
       export const Editor = ({ enabled }) => useState(enabled ? new AbortController() : null);`,
    ],
    [
      "a logical right operand",
      `import { useState } from "react";
       export const Editor = ({ enabled }) => useState(enabled && new AbortController());`,
    ],
    [
      "an object property",
      `import { useState } from "react";
       export const Editor = () => useState({ client: new ApiClient() });`,
    ],
    [
      "an array element",
      `import { useState } from "react";
       export const Editor = () => useState([new ApiClient()]);`,
    ],
    [
      "a sequence expression",
      `import { useState } from "react";
       export const Editor = () => useState((prepare(), new ApiClient()));`,
    ],
    [
      "a member read",
      `import { useState } from "react";
       export const Editor = () => useState(new ApiClient().status);`,
    ],
    [
      "transparent TypeScript wrappers",
      `import { useState } from "react";
       export const Editor = () => useState((new ApiClient() as ApiClient)!);`,
    ],
  ])("reports an eager constructor inside %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports only the first constructor in a multi-branch initializer", () => {
    const result = run(`import { useState } from "react";
      export const Editor = ({ mode }) =>
        useState(mode === "read" ? new ReadClient() : new WriteClient());`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an empty Set", "new Set<string>()"],
    ["an empty Map", "new Map()"],
    ["the current date", "new Date()"],
    ["constant DOM geometry", "new DOMPoint(0, 0)"],
    ["constant Map entries", 'new Map([["theme", defaults.theme]])'],
    ["a constant Set seed", "new Set([TAB_ONE, TAB_TWO])"],
    ["a globalThis built-in", "new globalThis.Map()"],
    ["a window built-in", "new window.Map()"],
  ])("allows %s", (_name, initializer) => {
    const result = run(`import { useState } from "react";
      export const Editor = ({ defaults }) => useState(${initializer});`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows a const alias of a cheap global constructor", () => {
    const result = run(`import { useState } from "react";
      const NativeMap = Map;
      const AlsoNativeMap = NativeMap;
      export const Editor = () => useState(new AlsoNativeMap());`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not overlap rerender-lazy-state-init for direct constructors", () => {
    const code = `import { useState } from "react";
      export const Editor = () => useState(new ApiClient());`;
    const constructorDiagnostics = run(code).diagnostics;
    const callDiagnostics = runRule(rerenderLazyStateInit, code).diagnostics;
    expect([...constructorDiagnostics, ...callDiagnostics]).toHaveLength(1);
  });

  it.each([
    [
      "a local useState lookalike",
      `const useState = (value) => value;
       export const Editor = () => useState(new ApiClient());`,
    ],
    [
      "a non-React useState import",
      `import { useState } from "state-library";
       export const Editor = () => useState(new ApiClient());`,
    ],
    [
      "a shadowed React import",
      `import { useState } from "react";
       export const Editor = () => {
         const useState = (value) => value;
         return useState(new ApiClient());
       };`,
    ],
    [
      "an already lazy initializer",
      `import { useState } from "react";
       export const Editor = () => useState(() => new ApiClient());`,
    ],
    [
      "a plain call initializer owned by rerender-lazy-state-init",
      `import { useState } from "react";
       export const Editor = () => useState(buildClient());`,
    ],
    [
      "a constructor passed to an eager call owned by rerender-lazy-state-init",
      `import { useState } from "react";
       export const Editor = () => useState(wrap(new ApiClient()));`,
    ],
    [
      "an identifier initializer",
      `import { useState } from "react";
       const client = new ApiClient();
       export const Editor = () => useState(client);`,
    ],
  ])("stays silent on %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
