// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: React Bench RDFPFN792026
import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";

const contextPattern = /context-([\w-]+)/;

export const readContext = (element: HTMLElement | null) => {
  const parent = element
    ? findUpUntil(element, (node) => Boolean(node.className.match(contextPattern)))
    : undefined;
  return parent?.className.match(contextPattern)![1] ?? "";
};

export const groupResults = (results: Array<{ section: { key: string }; value: string }>) => {
  const groups = new Map<string, string[]>();
  for (const result of results) {
    if (!groups.has(result.section.key)) groups.set(result.section.key, []);
    groups.get(result.section.key)!.push(result.value);
  }
  return groups;
};

export const latestSuccessfulValue = (
  attempts: Array<{ sequence: number; status: string; value: string }>,
) => {
  const maximum = attempts
    .filter((attempt) => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    return attempts.find((attempt) => attempt.sequence === maximum)!.value;
  }
  return null;
};
