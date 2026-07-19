// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: React Bench audit of millionco/react-doctor#1000
import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";

const contextMatch = /awsui-context-([\w-]+)/;

const hasVisualContextClass = (node: Element) => {
  return typeof node.className === "string" && !!node.className.match(contextMatch);
};

export const detectVisualContext = (node: HTMLElement) => {
  const contextParent = findUpUntil(node, hasVisualContextClass);
  if (contextParent && typeof contextParent.className === "string") {
    return contextParent.className.match(contextMatch)![1] ?? "";
  }
  return "";
};
