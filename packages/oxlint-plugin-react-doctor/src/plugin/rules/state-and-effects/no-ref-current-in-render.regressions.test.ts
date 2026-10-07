import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const run = (code: string) => runRule(noRefCurrentInRender, code);

describe("no-ref-current-in-render — falsy lazy initialization guards", () => {
  it.each([
    [
      "the authentic undefined-sentinel Map initialization",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (!itemRefs.current) itemRefs.current = new Map();
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "a null-sentinel object initialization",
      `import { useRef } from "react";
       const Panel = () => {
         const cacheRef = useRef<{ value: string } | null>(null);
         if (!cacheRef.current) cacheRef.current = { value: "ready" };
         return <output>{cacheRef.current.value}</output>;
       };`,
    ],
    [
      "a namespace useRef call",
      `import * as React from "react";
       const Panel = () => {
         const itemRefs = React.useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (!itemRefs.current) itemRefs.current = new Map();
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "an immutable current-value alias",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         const currentItems = itemRefs.current;
         if (!currentItems) itemRefs.current = new Map();
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "transparent TypeScript wrappers",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (!(itemRefs.current as Map<string, HTMLElement> | undefined)) {
           itemRefs.current = new Map() satisfies Map<string, HTMLElement>;
         }
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "a nested branch still dominated by the falsy guard",
      `import { useRef } from "react";
       const Panel = ({ shouldInitialize }: { shouldInitialize: boolean }) => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (!itemRefs.current) {
           if (shouldInitialize) itemRefs.current = new Map();
         }
         return itemRefs.current ? <output>{itemRefs.current.size}</output> : null;
       };`,
    ],
    [
      "a ref alias and multi-hop immutable initialization alias",
      `import { useRef } from "react";
       const Panel = () => {
         const firstMap = new Map<string, HTMLElement>();
         const secondMap = firstMap;
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         const itemRefsAlias = itemRefs;
         if (!itemRefsAlias.current) itemRefsAlias.current = secondMap;
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "both nullish sentinels in a closed domain",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | null | undefined>(null);
         if (!itemRefs.current) itemRefs.current = new Map();
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an unconditional reassignment",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef(new Map<string, HTMLElement>());
         itemRefs.current = new Map();
         return <output>{itemRefs.current.size}</output>;
       };`,
    ],
    [
      "a possibly falsy assigned value",
      `import { useRef } from "react";
       const Panel = ({ nextValue }: { nextValue: Map<string, HTMLElement> | undefined }) => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (!itemRefs.current) itemRefs.current = nextValue;
         return null;
       };`,
    ],
    [
      "a falsy assigned value",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<false | undefined>(undefined);
         if (!valueRef.current) valueRef.current = false;
         return null;
       };`,
    ],
    [
      "an open primitive domain",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<Map<string, string> | 0 | undefined>(undefined);
         if (!valueRef.current) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "an opaque type domain",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<unknown>(undefined);
         if (!valueRef.current) valueRef.current = {};
         return null;
       };`,
    ],
    [
      "a local type alias whose runtime domain is not proven",
      `import { useRef } from "react";
       type MaybeCache = Map<string, string> | undefined;
       const Panel = () => {
         const valueRef = useRef<MaybeCache>(undefined);
         if (!valueRef.current) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a later reset to the sentinel",
      `import { useEffect, useRef } from "react";
       const Panel = ({ shouldReset }: { shouldReset: boolean }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         if (!valueRef.current) valueRef.current = new Map();
         useEffect(() => {
           if (shouldReset) valueRef.current = undefined;
         }, [shouldReset]);
         return null;
       };`,
    ],
    [
      "a second write to current",
      `import { useRef } from "react";
       const Panel = ({ shouldReplace }: { shouldReplace: boolean }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         if (!valueRef.current) valueRef.current = new Map();
         if (shouldReplace) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a write inside a loop",
      `import { useRef } from "react";
       const Panel = ({ entries }: { entries: string[] }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         if (!valueRef.current) {
           for (const entry of entries) valueRef.current = new Map([[entry, entry]]);
         }
         return null;
       };`,
    ],
    [
      "a falsy guard nested inside a loop",
      `import { useRef } from "react";
       const Panel = ({ entries }: { entries: string[] }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         for (const entry of entries) {
           if (!valueRef.current) valueRef.current = new Map([[entry, entry]]);
         }
         return null;
       };`,
    ],
    [
      "a falsy guard inside a synchronous array callback",
      `import { useRef } from "react";
       const Panel = ({ entries }: { entries: string[] }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         entries.map((entry) => {
           if (!valueRef.current) valueRef.current = new Map([[entry, entry]]);
           return entry;
         });
         return null;
       };`,
    ],
    [
      "a guard over another ref",
      `import { useRef } from "react";
       const Panel = () => {
         const gateRef = useRef<Map<string, string> | undefined>(undefined);
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         if (!gateRef.current) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a non-sentinel initial value",
      `import { useRef } from "react";
       const Panel = ({ initialMap }: { initialMap: Map<string, string> | undefined }) => {
         const valueRef = useRef<Map<string, string> | undefined>(initialMap);
         if (!valueRef.current) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "an escaped ref object",
      `import { useRef } from "react";
       declare const registerRef: (value: { current: Map<string, string> | undefined }) => void;
       const Panel = () => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         registerRef(valueRef);
         if (!valueRef.current) valueRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a conditional initialization value",
      `import { useRef } from "react";
       const Panel = ({ enabled }: { enabled: boolean }) => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         if (!valueRef.current) valueRef.current = enabled ? new Map() : undefined;
         return null;
       };`,
    ],
    [
      "a destructured current alias",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<Map<string, string> | undefined>(undefined);
         const { current } = valueRef;
         if (!current) valueRef.current = new Map();
         return null;
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "explicit undefined equality",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         if (itemRefs.current === undefined) itemRefs.current = new Map();
         return null;
       };`,
    ],
    [
      "logical-or assignment",
      `import { useRef } from "react";
       const Panel = () => {
         const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
         itemRefs.current ||= new Map();
         return null;
       };`,
    ],
  ])("preserves the existing exemption for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-ref-current-in-render — predictable initialization proofs", () => {
  it.each([
    [
      "an object value for an opaque object-shaped ref",
      `import { useRef } from "react";
       interface Controls {
         focus: () => void;
       }
       const Panel = () => {
         const controlsRef = useRef<Controls | null>(null);
         if (!controlsRef.current) controlsRef.current = { focus: () => undefined };
         return null;
       };`,
    ],
    [
      "an object value for an indexed-access ref type",
      `import { useRef } from "react";
       interface Controls {
         navigation: { focus: () => void };
       }
       const Panel = () => {
         const navigationRef = useRef<Controls["navigation"]>();
         if (!navigationRef.current) navigationRef.current = { focus: () => undefined };
         return null;
       };`,
    ],
    [
      "a typed zero-input factory",
      `import { useRef } from "react";
       interface Controls {
         focus: () => void;
       }
       declare const createControls: () => Controls;
       const Panel = () => {
         const controlsRef = useRef<Controls>();
         if (!controlsRef.current) controlsRef.current = createControls();
         return null;
       };`,
    ],
    [
      "a ReturnType-matched factory",
      `import { useRef } from "react";
       declare const debounce: (callback: () => void, delay: number) => () => void;
       const Panel = () => {
         const callbackRef = useRef<() => void>(() => undefined);
         const debouncedRef = useRef<ReturnType<typeof debounce> | null>(null);
         if (!debouncedRef.current) {
           debouncedRef.current = debounce(() => callbackRef.current(), 50);
         }
         return null;
       };`,
    ],
    [
      "a stable new value under an equality guard",
      `import { useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a later write in an event handler",
      `import { useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         const reset = () => {
           mapRef.current = new Map([["ready", "yes"]]);
         };
         return <button onClick={reset}>Replace</button>;
       };`,
    ],
    [
      "a later write in an effect",
      `import { useEffect, useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         useEffect(() => {
           mapRef.current = new Map([["ready", "yes"]]);
         }, []);
         return null;
       };`,
    ],
    [
      "a stored callback that reads the clock when invoked",
      `import { useRef } from "react";
       const Panel = () => {
         const clockRef = useRef<{ read: () => number } | null>(null);
         if (clockRef.current === null) {
           clockRef.current = { read: () => Date.now() };
         }
         return null;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a prop-derived equality initialization",
      `import { useRef } from "react";
       const Panel = ({ data }: { data: Map<string, string> }) => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = data;
         return null;
       };`,
    ],
    [
      "a transitively prop-derived equality initialization",
      `import { useRef } from "react";
       const Panel = ({ data }: { data: Map<string, string> }) => {
         const nextData = data;
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = nextData;
         return null;
       };`,
    ],
    [
      "a mutable module value under an equality guard",
      `import { useRef } from "react";
       let nextData = new Map<string, string>();
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = nextData;
         return null;
       };`,
    ],
    [
      "an unproven factory under an equality guard",
      `import { useRef } from "react";
       declare const factory: () => unknown;
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) valueRef.current = factory();
         return null;
       };`,
    ],
    [
      "an escaped ref under an equality guard",
      `import { useRef } from "react";
       declare const consume: (ref: { current: Map<string, string> | null }) => void;
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         consume(mapRef);
         if (mapRef.current === null) mapRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a prior co-executable write under an equality guard",
      `import { useRef } from "react";
       const Panel = ({ replacement }: { replacement: Map<string, string> }) => {
         const mapRef = useRef<Map<string, string> | null>(null);
         mapRef.current = replacement;
         if (mapRef.current === null) mapRef.current = new Map();
         return null;
       };`,
    ],
    [
      "a later co-executable reset after an equality guard",
      `import { useRef } from "react";
       const Panel = ({ shouldReset }: { shouldReset: boolean }) => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         if (shouldReset) mapRef.current = null;
         return null;
       };`,
    ],
    [
      "a later co-executable reset in a synchronous callback",
      `import { useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         [1].forEach(() => {
           mapRef.current = null;
         });
         return null;
       };`,
    ],
    [
      "a later co-executable reset in a called local function",
      `import { useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         const reset = () => {
           mapRef.current = null;
         };
         reset();
         return null;
       };`,
    ],
    [
      "a prop-dependent constructor under a falsy guard",
      `import { useRef } from "react";
       declare class Parser {
         constructor(country: string);
       }
       const Panel = ({ country }: { country: string }) => {
         const parserRef = useRef<Parser>();
         if (!parserRef.current) parserRef.current = new Parser(country);
         return null;
       };`,
    ],
    [
      "a prop-derived nullish assignment",
      `import { useRef } from "react";
       const Panel = ({ data }: { data: Map<string, string> }) => {
         const mapRef = useRef<Map<string, string> | null>(null);
         mapRef.current ??= data;
         return null;
       };`,
    ],
    [
      "a random value captured during object initialization",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<{ id: number } | null>(null);
         if (valueRef.current === null) {
           valueRef.current = { id: Math.random() };
         }
         return null;
       };`,
    ],
    [
      "a wall-clock value captured during object initialization",
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<{ createdAt: Date } | null>(null);
         if (valueRef.current === null) {
           valueRef.current = { createdAt: new Date() };
         }
         return null;
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "useMemo",
      `import { useMemo, useRef } from "react";
       const Panel = () => {
         const mapRef = useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         useMemo(() => {
           mapRef.current = new Map([["ready", "yes"]]);
           return mapRef.current;
         }, []);
         return null;
       };`,
    ],
    [
      "a lazy useState initializer",
      `import React from "react";
       const Panel = () => {
         const mapRef = React.useRef<Map<string, string> | null>(null);
         if (mapRef.current === null) mapRef.current = new Map();
         React.useState(() => {
           mapRef.current = new Map([["ready", "yes"]]);
           return mapRef.current;
         });
         return null;
       };`,
    ],
  ])("reports both co-executable writes for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
