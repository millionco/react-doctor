// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: synthetic regression
// verdict: pass

import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";

const panelPattern = /panel-accent-([a-z]+)/;

export const readPanelAccent = (element: HTMLElement) => {
  const parent = findUpUntil(
    element,
    (node) => typeof node.className === "string" && !!node.className.match(panelPattern),
  );
  const accent = parent ? parent.className.match(panelPattern)![1] : "";
  return accent;
};
