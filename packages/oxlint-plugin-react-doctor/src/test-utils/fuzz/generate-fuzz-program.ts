import type { SeededRandom } from "./seeded-random.js";

type SnippetBuilder = (random: SeededRandom) => string;

const IDENTIFIER_POOL = [
  "value",
  "data",
  "items",
  "user",
  "config",
  "resolvedValue",
  "$dollar",
  "_underscore",
  "ключ",
  "変数",
  "ItemsList",
  "useThing",
] as const;

const HTML_TAG_POOL = [
  "div",
  "span",
  "a",
  "img",
  "button",
  "input",
  "p",
  "table",
  "tr",
  "td",
  "ul",
  "li",
  "form",
  "label",
  "select",
  "iframe",
  "video",
  "marquee",
  "dialog",
] as const;

const ATTRIBUTE_POOL = [
  `role="button"`,
  `role={dynamicRole}`,
  `aria-hidden="true"`,
  `aria-label={label}`,
  `alt=""`,
  `alt={altText}`,
  `href="#"`,
  `href={url}`,
  `tabIndex={-1}`,
  `onClick={() => handle()}`,
  `onClick={handle}`,
  `onKeyDown={handle}`,
  `style={{ color: "red" }}`,
  `key={index}`,
  `key={item.id}`,
  `key={Math.random()}`,
  `dangerouslySetInnerHTML={{ __html: value }}`,
  `{...restProps}`,
  `data-testid="fuzz"`,
  `className={\`btn \${variant}\`}`,
  `checked={isChecked}`,
  `defaultValue={value}`,
  `autoFocus`,
] as const;

const HOOK_STATEMENT_POOL = [
  `const [state, setState] = useState(0);`,
  `const [state, setState] = React.useState(() => compute());`,
  `const stateRef = useRef<HTMLDivElement | null>(null);`,
  `const memoized = useMemo(() => items.map((item) => item.id), [items]);`,
  `const memoized = useMemo(() => ({ deep: { value } }), []);`,
  `const callback = useCallback(() => setState((prev) => prev + 1), []);`,
  `const callback = useCallback(async () => { await fetch(url); }, [url]);`,
  `useEffect(() => { document.title = String(state); }, [state]);`,
  `useEffect(() => { const id = setInterval(tick, 1000); }, []);`,
  `useEffect(() => { const id = setInterval(tick, 1000); return () => clearInterval(id); }, []);`,
  `useEffect(() => { setState(state + 1); }, [state]);`,
  `useLayoutEffect(() => { stateRef.current?.focus(); });`,
  `const context = useContext(ThemeContext);`,
  `const [isPending, startTransition] = useTransition();`,
  `const deferred = useDeferredValue(state);`,
  `const id = useId();`,
] as const;

const STATEMENT_POOL = [
  `const derived = state * 2;`,
  `let mutable = 0; mutable += 1;`,
  `if (typeof window !== "undefined") { window.localStorage.setItem("token", value); }`,
  `const parsed = JSON.parse(JSON.stringify(items));`,
  `console.log("debug", state);`,
  `const promise = fetch("/api/data").then((response) => response.json());`,
  `for (const item of items) { if (item == null) continue; }`,
  `try { riskyOperation(); } catch { /* swallowed */ }`,
  `const html = "<b>" + value + "</b>";`,
  `const query = \`SELECT * FROM users WHERE id = \${value}\`;`,
  `document.querySelector("#root")?.addEventListener("scroll", handle);`,
  `const timestamp = Date.now();`,
  `eval(value);`,
  `const clone = structuredClone(config);`,
  `while (mutableCondition()) { break; }`,
] as const;

const EDGE_CASE_STATEMENT_POOL = [
  `const useState = () => [0, () => {}] as const;`,
  `const { useEffect: renamedEffect } = React;`,
  `const shadowed = (useMemo: () => void) => useMemo();`,
  `const conditionalHook = () => { if (Math.random() > 0.5) { useState(0); } };`,
  `function* generatorWithHookName() { yield useRef; }`,
  `const nested = () => () => () => useCallback(() => {}, []);`,
  `const computed = { ["use" + "State"]: 1 };`,
  `const optional = config?.nested?.[key]?.();`,
  `const asserted = (value as unknown as { deep: string }).deep!;`,
  `enum Direction { Up, Down }`,
  `type Recursive<T> = { child: Recursive<T> } | T;`,
  `const satisfied = { mode: "dark" } satisfies { mode: string };`,
  `label: for (let index = 0; index < 3; index += 1) { continue label; }`,
  `const tagged = html\`<div onclick="\${value}"></div>\`;`,
  `export default class extends React.Component { render() { return null; } }`,
] as const;

const buildImportBlock: SnippetBuilder = (random) => {
  const candidates = [
    `import React from "react";`,
    `import * as React from "react";`,
    `import { useState, useEffect, useMemo, useCallback, useRef, useContext, useTransition, useDeferredValue, useId, useLayoutEffect } from "react";`,
    `import { useState as useLocalState } from "react";`,
    `import Link from "next/link";`,
    `import Image from "next/image";`,
    `import { View, Text, FlatList } from "react-native";`,
    `import { useQuery, useMutation } from "@tanstack/react-query";`,
    `import { atom, useAtom } from "jotai";`,
    `import { z } from "zod";`,
    `import dynamic from "next/dynamic";`,
  ];
  const importCount = random.intBetween(1, 5);
  const chosen = new Set<string>();
  for (let index = 0; index < importCount; index += 1) chosen.add(random.pick(candidates));
  return [...chosen].join("\n");
};

const buildJsxTree = (random: SeededRandom, depth: number): string => {
  if (depth <= 0) {
    return random.pick([
      `{state}`,
      `{items.map((item, index) => <li key={index}>{item}</li>)}`,
      `{items.map((item) => <li key={item.id}>{item.name}</li>)}`,
      `text content`,
      `{condition ? <span>yes</span> : null}`,
      `{condition && <em>maybe</em>}`,
      `{...items}`,
      `<>{state}</>`,
    ]);
  }
  const tag = random.pick(HTML_TAG_POOL);
  const attributeCount = random.int(3);
  const attributes: string[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    attributes.push(random.pick(ATTRIBUTE_POOL));
  }
  const attributeText = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  if (random.chance(0.2)) return `<${tag}${attributeText} />`;
  const childCount = random.intBetween(1, 3);
  const children: string[] = [];
  for (let index = 0; index < childCount; index += 1) {
    children.push(buildJsxTree(random, depth - 1));
  }
  return `<${tag}${attributeText}>${children.join("")}</${tag}>`;
};

const buildComponent: SnippetBuilder = (random) => {
  const componentName = `Fuzz${random.pick(["Panel", "Card", "List", "Widget", "Overlay"])}${random.int(100)}`;
  const bodyStatements: string[] = [];
  const hookCount = random.int(4);
  for (let index = 0; index < hookCount; index += 1) {
    bodyStatements.push(random.pick(HOOK_STATEMENT_POOL));
  }
  const statementCount = random.int(3);
  for (let index = 0; index < statementCount; index += 1) {
    bodyStatements.push(random.pick(STATEMENT_POOL));
  }
  if (random.chance(0.3)) bodyStatements.push(random.pick(EDGE_CASE_STATEMENT_POOL));
  const jsx = buildJsxTree(random, random.intBetween(1, 4));
  const propsPattern = random.pick([
    `()`,
    `({ items, value, onSelect })`,
    `(props)`,
    `({ items = [], ...restProps })`,
  ]);
  const exportPrefix = random.chance(0.5) ? "export " : "";
  return [
    `${exportPrefix}const ${componentName} = ${propsPattern} => {`,
    ...bodyStatements.map((statement) => `  ${statement}`),
    `  return (${jsx});`,
    `};`,
  ].join("\n");
};

const buildCustomHook: SnippetBuilder = (random) => {
  const hookName = `useFuzz${random.pick(["Data", "Toggle", "Tracker"])}${random.int(100)}`;
  const body = random.pick([
    `const [state, setState] = useState(false);\n  useEffect(() => { setState(true); }, []);\n  return state;`,
    `const stored = useRef(initial);\n  return stored.current;`,
    `if (!globalThis.flag) return null;\n  return useContext(ThemeContext);`,
    `const [state, setState] = useState(initial);\n  const toggle = useCallback(() => setState((prev) => !prev), []);\n  return [state, toggle] as const;`,
  ]);
  return `const ${hookName} = (initial) => {\n  ${body}\n};`;
};

const buildModuleNoise: SnippetBuilder = (random) =>
  random.pick([
    `const GLOBAL_CACHE = new Map<string, unknown>();`,
    `let moduleMutableState = 0;`,
    `const ThemeContext = React.createContext({ mode: "light" });`,
    `export const dynamicComponent = dynamic(() => import("./heavy"), { ssr: false });`,
    `const SECRET_KEY = "sk-live-abc123def456ghi789jkl012mno345";`,
    `if (typeof process !== "undefined") { process.env.NODE_ENV; }`,
    random.pick(EDGE_CASE_STATEMENT_POOL),
    `const ${random.pick(IDENTIFIER_POOL)} = ${random.int(1000)};`,
  ]);

export const generateFuzzProgram = (random: SeededRandom): string => {
  const sections: string[] = [buildImportBlock(random)];
  const moduleNoiseCount = random.int(3);
  for (let index = 0; index < moduleNoiseCount; index += 1) {
    sections.push(buildModuleNoise(random));
  }
  if (random.chance(0.4)) sections.push(buildCustomHook(random));
  const componentCount = random.intBetween(1, 3);
  for (let index = 0; index < componentCount; index += 1) {
    sections.push(buildComponent(random));
  }
  return `${sections.join("\n\n")}\n`;
};
