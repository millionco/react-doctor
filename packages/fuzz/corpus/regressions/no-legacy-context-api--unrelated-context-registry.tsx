// rule: no-legacy-context-api
// weakness: component-provenance
// source: ISSUES_TO_FIX_ASAP.md unrelated registry false positive
import React from "react";

export class ProtocolRegistry {
  static contextTypes = new Set<string>(["json", "text"]);
  static childContextTypes = new Map<string, unknown>();
  getChildContext() {
    return { protocol: "json" };
  }
}

export const Registry: { contextTypes?: ReadonlySet<string> } = {};
Registry.contextTypes = new Set<string>(["json", "text"]);

class Component {}
export class ShadowedWidget extends Component {
  static contextTypes = {};
}

export const ReactVersion = React.version;
