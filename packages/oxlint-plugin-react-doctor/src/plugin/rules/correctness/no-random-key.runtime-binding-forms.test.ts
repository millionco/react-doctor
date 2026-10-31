import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRandomKey } from "./no-random-key.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 1,
  },
  {
    name: "genuine local value",
    code: 'const globalThis = { note: 0 };globalThis.note = 1;import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 1,
  },
  {
    name: "interface after genuine local value",
    code: 'const globalThis = { note: 0 };interface globalThis {}globalThis.note = 1;import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 1,
  },
  {
    name: "interface before genuine local value",
    code: 'interface globalThis {}const globalThis = { note: 0 };globalThis.note = 1;import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 1,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: 'const globalThis = { note: 0 };const inspectProvider = () => { interface globalThis {} globalThis.note = 1; };import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 1,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type globalThis = require("provider-types");globalThis.require("uuid").v4 = () => "stable";import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis {}",
    code: 'namespace globalThis {}globalThis.require("uuid").v4 = () => "stable";import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export interface Marker {} }",
    code: 'namespace globalThis { export interface Marker {} }globalThis.require("uuid").v4 = () => "stable";import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export namespace Nested { export interface Marker {} } }",
    code: 'namespace globalThis { export namespace Nested { export interface Marker {} } }globalThis.require("uuid").v4 = () => "stable";import {v4 as makeKey} from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }]; const Cards = () => { const cards = makeCards(); return <>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</>; }; export const Example = () => <Cards />;',
    expected: 0,
  },
];
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: {
      version: "19.0.0",
    },
  },
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noRandomKey, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
