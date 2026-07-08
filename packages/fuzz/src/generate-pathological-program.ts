import {
  DEEP_JSX_NESTING_DEPTH,
  LONG_CHAIN_LINK_COUNT,
  NESTED_TERNARY_DEPTH,
  WIDE_COMPONENT_STATEMENT_COUNT,
  WIDE_SIBLING_COUNT,
} from "./constants.js";
import type { SeededRandom } from "./seeded-random.js";

// Pathological shapes probe the two failure modes realistic programs never
// reach: stack overflows in recursive AST walkers (depth) and quadratic
// scans (width). Each builder scales its dimension by a random factor so
// different seeds probe different sizes.

const buildDeepJsxNesting = (random: SeededRandom): string => {
  const depth = Math.floor(DEEP_JSX_NESTING_DEPTH * (0.5 + random.next()));
  const open = `<div className="level">`.repeat(depth);
  const close = `</div>`.repeat(depth);
  return `export const DeepTree = () => (\n  ${open}{value}${close}\n);`;
};

const buildLongOptionalChain = (random: SeededRandom): string => {
  const linkCount = Math.floor(LONG_CHAIN_LINK_COUNT * (0.5 + random.next()));
  const chain = `?.child`.repeat(linkCount);
  return `export const DeepChain = () => <span>{config${chain}?.name ?? "none"}</span>;`;
};

const buildLongBinaryChain = (random: SeededRandom): string => {
  const termCount = Math.floor(LONG_CHAIN_LINK_COUNT * (0.5 + random.next()));
  const terms = Array.from({ length: termCount }, (_, index) => `value${index % 7}`).join(" + ");
  return `const longSum = ${terms};\nexport const SumLabel = () => <span>{longSum}</span>;`;
};

const buildWideSiblingList = (random: SeededRandom): string => {
  const siblingCount = Math.floor(WIDE_SIBLING_COUNT * (0.5 + random.next()));
  const siblings = Array.from(
    { length: siblingCount },
    (_, index) => `<li key={${index}} onClick={() => handle(${index})}>{items[${index}]}</li>`,
  ).join("\n    ");
  return `export const WideList = () => (\n  <ul>\n    ${siblings}\n  </ul>\n);`;
};

const buildNestedTernaries = (random: SeededRandom): string => {
  const depth = Math.floor(NESTED_TERNARY_DEPTH * (0.5 + random.next()));
  let expression = `"base"`;
  for (let index = 0; index < depth; index += 1) {
    expression = `value === ${index} ? "v${index}" : (${expression})`;
  }
  return `export const TernaryLabel = () => <span>{${expression}}</span>;`;
};

const buildWideComponentBody = (random: SeededRandom): string => {
  const statementCount = Math.floor(WIDE_COMPONENT_STATEMENT_COUNT * (0.5 + random.next()));
  const statements = Array.from(
    { length: statementCount },
    (_, index) => `  const derived${index} = state + ${index};`,
  ).join("\n");
  return [
    `export const WideBody = () => {`,
    `  const [state, setState] = useState(0);`,
    statements,
    `  useEffect(() => { setState(derived0); }, []);`,
    `  return <div onClick={() => setState(derived${statementCount - 1})}>{state}</div>;`,
    `};`,
  ].join("\n");
};

const buildManyHookCalls = (random: SeededRandom): string => {
  const hookCount = Math.floor((WIDE_COMPONENT_STATEMENT_COUNT / 2) * (0.5 + random.next()));
  const hooks = Array.from(
    { length: hookCount },
    (_, index) => `  const [slot${index}, setSlot${index}] = useState(${index});`,
  ).join("\n");
  return [`export const ManyHooks = () => {`, hooks, `  return <div>{slot0}</div>;`, `};`].join(
    "\n",
  );
};

const PATHOLOGICAL_BUILDER_POOL = [
  buildDeepJsxNesting,
  buildLongOptionalChain,
  buildLongBinaryChain,
  buildWideSiblingList,
  buildNestedTernaries,
  buildWideComponentBody,
  buildManyHookCalls,
] as const;

export const generatePathologicalProgram = (random: SeededRandom): string => {
  const builder = random.pick(PATHOLOGICAL_BUILDER_POOL);
  return [`import { useState, useEffect } from "react";`, ``, builder(random), ``].join("\n");
};
