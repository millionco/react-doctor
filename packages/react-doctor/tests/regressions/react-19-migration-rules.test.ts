import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-react19-migration-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("no-react-dom-deprecated-apis", () => {
  it("flags react-dom legacy root and rendering APIs imported by name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-react-dom-deprecated-apis-named", {
      files: {
        "src/legacy.tsx": `import { render, hydrate, unmountComponentAtNode, findDOMNode } from "react-dom";

void render;
void hydrate;
void unmountComponentAtNode;
void findDOMNode;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis");
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.some((hit) => hit.message.includes("ReactDOM.render"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("ReactDOM.hydrate"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("unmountComponentAtNode"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("findDOMNode"))).toBe(true);
  });

  it("flags react-dom legacy APIs accessed via namespace binding", async () => {
    const projectDir = setupReactProject(tempRoot, "no-react-dom-deprecated-apis-namespace", {
      files: {
        "src/legacy.tsx": `import ReactDOM from "react-dom";

const container = document.getElementById("root")!;
ReactDOM.render(null as any, container);
ReactDOM.hydrate(null as any, container);
ReactDOM.unmountComponentAtNode(container);
const node = ReactDOM.findDOMNode(null as any);
void node;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis");
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.some((hit) => hit.message.includes("createRoot"))).toBe(true);
  });

  it("flags every import from react-dom/test-utils", async () => {
    const projectDir = setupReactProject(tempRoot, "no-react-dom-deprecated-apis-test-utils", {
      files: {
        "src/legacy.test.tsx": `import { act, Simulate, renderIntoDocument } from "react-dom/test-utils";

void act;
void Simulate;
void renderIntoDocument;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((hit) => hit.message.includes("act"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("fireEvent"))).toBe(true);
  });

  it("does not flag modern react-dom/client createRoot/hydrateRoot", async () => {
    const projectDir = setupReactProject(tempRoot, "no-react-dom-deprecated-apis-modern", {
      files: {
        "src/main.tsx": `import { createRoot, hydrateRoot } from "react-dom/client";

void createRoot;
void hydrateRoot;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis");
    expect(hits).toHaveLength(0);
  });
});

describe("no-legacy-class-lifecycles", () => {
  it("flags componentWillMount / componentWillReceiveProps / componentWillUpdate", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-pos", {
      files: {
        "src/Legacy.tsx": `import React from "react";

export class Legacy extends React.Component<{}, {}> {
  componentWillMount() {}
  componentWillReceiveProps() {}
  componentWillUpdate() {}
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits.length).toBe(3);
    expect(hits.some((hit) => hit.message.includes("componentWillMount"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("componentWillReceiveProps"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("componentWillUpdate"))).toBe(true);
  });

  it("flags UNSAFE_-prefixed lifecycles too and notes the prefix is not a fix", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-unsafe", {
      files: {
        "src/Legacy.tsx": `import React from "react";

export class Legacy extends React.Component<{}, {}> {
  UNSAFE_componentWillMount() {}
  UNSAFE_componentWillReceiveProps() {}
  UNSAFE_componentWillUpdate() {}
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits.length).toBe(3);
    expect(hits.every((hit) => hit.message.includes("UNSAFE_"))).toBe(true);
    expect(hits.every((hit) => hit.message.includes("React 19"))).toBe(true);
  });

  it("does not flag componentDidMount / componentDidUpdate / componentWillUnmount", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-modern", {
      files: {
        "src/Modern.tsx": `import React from "react";

export class Modern extends React.Component<{}, {}> {
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a function with a similar name outside a class body", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-function", {
      files: {
        "src/util.ts": `export function componentWillMount() {}
export function componentWillReceiveProps() {}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits).toHaveLength(0);
  });

  // HACK: regression for the prototype-pollution false positive.
  // Plain-object lookups (`messages["constructor"]`) inherit from
  // `Object.prototype`, so `replacement` was the native Object function
  // (truthy). Every Lexical/MobX/Three.js/etc. class with a `constructor`
  // fired with a message ending in `function Object() { [native code] }`.
  it("does not flag a plain `constructor` (Lexical-style class with no React lifecycles)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-ctor", {
      files: {
        "src/lexical-node.ts": `import { TextNode } from "lexical";

export class AutocompleteSuggestionNode extends TextNode {
  __suggestion: string;

  constructor(suggestion: string, key?: string) {
    super(suggestion, key);
    this.__suggestion = suggestion;
  }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits).toHaveLength(0);
  });

  it("does not flag class members named after Object.prototype properties (toString, hasOwnProperty, etc.)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-class-lifecycles-proto-names", {
      files: {
        "src/Custom.tsx": `import React from "react";

export class Custom extends React.Component<{}, {}> {
  toString() { return "Custom"; }
  hasOwnProperty(key: string) { return key === "x"; }
  valueOf() { return 0; }
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles");
    expect(hits).toHaveLength(0);
  });
});

describe("no-legacy-context-api", () => {
  it("flags childContextTypes + getChildContext on a provider class", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-context-api-provider", {
      files: {
        "src/Provider.tsx": `import React from "react";

export class ThemeProvider extends React.Component<{ children: React.ReactNode }, {}> {
  static childContextTypes = { theme: () => null };
  getChildContext() { return { theme: "dark" }; }
  render() { return this.props.children; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-context-api");
    expect(hits.length).toBe(2);
    expect(hits.some((hit) => hit.message.includes("childContextTypes"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("getChildContext"))).toBe(true);
  });

  it("flags contextTypes on a class consumer", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-context-api-consumer", {
      files: {
        "src/Consumer.tsx": `import React from "react";

export class ThemedButton extends React.Component<{}, {}> {
  static contextTypes = { theme: () => null };
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-context-api");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("contextTypes");
  });

  it("flags out-of-class assignments like Foo.childContextTypes = {...}", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-context-api-assignment", {
      files: {
        "src/Provider.tsx": `import React from "react";

class ThemeProvider extends React.Component<{ children: React.ReactNode }, {}> {
  render() { return this.props.children; }
}

ThemeProvider.childContextTypes = { theme: () => null };
ThemeProvider.contextTypes = { theme: () => null };

export { ThemeProvider };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-context-api");
    expect(hits.length).toBe(2);
  });

  it("does not flag the modern createContext / contextType / useContext API", async () => {
    const projectDir = setupReactProject(tempRoot, "no-legacy-context-api-modern", {
      files: {
        "src/Theme.tsx": `import React, { createContext, useContext } from "react";

const ThemeContext = createContext<string>("light");

export class ThemedButton extends React.Component<{}, {}> {
  static contextType = ThemeContext;
  render() { return null; }
}

export const useTheme = () => useContext(ThemeContext);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-context-api");
    expect(hits).toHaveLength(0);
  });
});

describe("no-default-props", () => {
  it("flags Foo.defaultProps = { ... } on a function component", async () => {
    const projectDir = setupReactProject(tempRoot, "no-default-props-pos", {
      files: {
        "src/Button.tsx": `interface ButtonProps { size?: string; variant?: string }

export const Button = ({ size, variant }: ButtonProps) => (
  <button data-size={size} data-variant={variant} />
);

Button.defaultProps = {
  size: "md",
  variant: "primary",
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("Button");
    expect(hits[0].message).toContain("destructured props parameter");
  });

  it("does not flag ES6 default parameters in destructured props", async () => {
    const projectDir = setupReactProject(tempRoot, "no-default-props-modern", {
      files: {
        "src/Button.tsx": `interface ButtonProps { size?: string; variant?: string }

export const Button = ({ size = "md", variant = "primary" }: ButtonProps) => (
  <button data-size={size} data-variant={variant} />
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a non-component lowercase identifier", async () => {
    const projectDir = setupReactProject(tempRoot, "no-default-props-lowercase", {
      files: {
        "src/util.ts": `const config = { defaults: {} } as { defaults: Record<string, unknown>; defaultProps?: Record<string, unknown> };
config.defaultProps = { name: "default" };
export { config };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props");
    expect(hits).toHaveLength(0);
  });
});

describe("no-prop-types", () => {
  it("flags Component.propTypes = { ... } on a function component", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-assignment", {
      files: {
        "src/Rating.tsx": `import PropTypes from "prop-types";

export function Rating({ value }: { value?: number }) {
  return <span>{value}</span>;
}

Rating.propTypes = {
  value: PropTypes.number,
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("Rating");
    expect(hits[0].message).toContain("React 19");
  });

  it("flags a static propTypes class field on a class component", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-class-static", {
      files: {
        "src/Rating.tsx": `import React from "react";
import PropTypes from "prop-types";

export class Rating extends React.Component<{ value?: number }> {
  static propTypes = {
    value: PropTypes.number,
  };
  render() {
    return <span>{this.props.value}</span>;
  }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("Rating");
  });

  it("flags a static propTypes field on a class assigned to an uppercase const", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-class-expr", {
      files: {
        "src/Rating.tsx": `import React from "react";
import PropTypes from "prop-types";

export const Rating = class extends React.Component<{ value?: number }> {
  static propTypes = {
    value: PropTypes.number,
  };
  render() {
    return <span>{this.props.value}</span>;
  }
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("Rating");
  });

  it('flags a computed Component["propTypes"] = { ... } assignment', async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-computed", {
      files: {
        "src/Rating.tsx": `import PropTypes from "prop-types";

export function Rating({ value }: { value?: number }) {
  return <span>{value}</span>;
}

Rating["propTypes"] = {
  value: PropTypes.number,
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("Rating");
  });

  it("does not flag TypeScript prop types with destructuring defaults", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-modern", {
      files: {
        "src/Rating.tsx": `interface Props {
  value?: number;
}

export function Rating({ value = 0 }: Props) {
  return <span>{value}</span>;
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a propTypes property on a lowercase (non-component) object", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-lowercase", {
      files: {
        "src/util.ts": `const config = {} as { propTypes?: Record<string, unknown> };
config.propTypes = { value: 1 };
export { config };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a static propTypes field on a lowercase-named class", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-lowercase-class", {
      files: {
        "src/validator.ts": `export class validator {
  static propTypes = { value: 1 };
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits).toHaveLength(0);
  });

  it("does not flag an instance (non-static) propTypes class field", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-types-instance-field", {
      files: {
        "src/Model.ts": `export class Model {
  propTypes = { value: 1 };
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types");
    expect(hits).toHaveLength(0);
  });
});

describe("version gating", () => {
  it("does NOT flag createFactory on React 18 projects (migration-hint, suppressed below minMajor)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r18-createFactory", {
      reactVersion: "^18.3.1",
      files: {
        "src/legacy.tsx": `import React from "react";

export const createLegacyButton = React.createFactory("button");
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react19-deprecated-apis", {
      reactMajorVersion: 18,
    });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag createFactory on React 17 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r17-createFactory", {
      reactVersion: "^17.0.2",
      files: {
        "src/legacy.tsx": `import React from "react";

export const createLegacyButton = React.createFactory("button");
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react19-deprecated-apis", {
      reactMajorVersion: 17,
    });
    expect(hits).toHaveLength(0);
  });

  it("accepts forwardRef and flags createFactory on React 19 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r19-react-apis", {
      files: {
        "src/Button.tsx": `import React, { forwardRef } from "react";

export const Button = forwardRef<HTMLButtonElement>((_props, ref) => (
  <button ref={ref} />
));

export const createLegacyButton = React.createFactory("button");
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react19-deprecated-apis", {
      reactMajorVersion: 19,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain("createFactory");
    expect(hits[0]?.message).not.toContain("forwardRef");
  });

  it("does NOT flag createFactory when the React version is unknown", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-null-createFactory", {
      reactVersion: "*",
      files: {
        "src/legacy.tsx": `import React from "react";

export const createLegacyButton = React.createFactory("button");
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react19-deprecated-apis", {
      reactMajorVersion: null,
    });
    expect(hits).toHaveLength(0);
  });

  // HACK: regression for the prototype-pollution sibling of the
  // `constructor` FP. `messages[importedName]` previously fell through
  // to `Object.prototype.toString` etc. when the user imported (or member-
  // accessed) a name shared with a base Object property.
  it("does NOT flag React.toString() / React.hasOwnProperty (prototype-name member access)", async () => {
    const projectDir = setupReactProject(tempRoot, "deprecated-apis-proto-names", {
      files: {
        "src/index.tsx": `import React from "react";

export const debug = (): string => React.toString();
export const has = (key: string): boolean => React.hasOwnProperty(key);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react19-deprecated-apis", {
      reactMajorVersion: 19,
    });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag Foo.defaultProps on React 18 projects (migration-hint, suppressed below minMajor)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r18-defaultProps", {
      reactVersion: "^18.3.1",
      files: {
        "src/Button.tsx": `export const Button = ({ size }: { size?: string }) => <button data-size={size} />;
Button.defaultProps = { size: "md" };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props", { reactMajorVersion: 18 });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag Foo.defaultProps on React 17 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r17-defaultProps", {
      reactVersion: "^17.0.2",
      files: {
        "src/Button.tsx": `export const Button = ({ size }: { size?: string }) => <button data-size={size} />;
Button.defaultProps = { size: "md" };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props", { reactMajorVersion: 17 });
    expect(hits).toHaveLength(0);
  });

  it("DOES flag Foo.defaultProps on React 19 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r19-defaultProps", {
      reactVersion: "^19.0.0",
      files: {
        "src/Button.tsx": `export const Button = ({ size }: { size?: string }) => <button data-size={size} />;
Button.defaultProps = { size: "md" };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props", { reactMajorVersion: 19 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag Component.propTypes on React 18 projects (propTypes still runs pre-19)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r18-propTypes", {
      reactVersion: "^18.3.1",
      files: {
        "src/Rating.tsx": `import PropTypes from "prop-types";
export function Rating({ value }: { value?: number }) { return <span>{value}</span>; }
Rating.propTypes = { value: PropTypes.number };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types", { reactMajorVersion: 18 });
    expect(hits).toHaveLength(0);
  });

  it("DOES flag Component.propTypes on React 19 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r19-propTypes", {
      reactVersion: "^19.0.0",
      files: {
        "src/Rating.tsx": `import PropTypes from "prop-types";
export function Rating({ value }: { value?: number }) { return <span>{value}</span>; }
Rating.propTypes = { value: PropTypes.number };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types", { reactMajorVersion: 19 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag Component.propTypes when the React version is unknown", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-null-propTypes", {
      reactVersion: "*",
      files: {
        "src/Rating.tsx": `import PropTypes from "prop-types";
export function Rating({ value }: { value?: number }) { return <span>{value}</span>; }
Rating.propTypes = { value: PropTypes.number };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-types", { reactMajorVersion: null });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag react-dom render on React 17 projects (deprecated since 18, not 17)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r17-render", {
      reactVersion: "^17.0.2",
      files: {
        "src/main.tsx": `import { render } from "react-dom";

void render;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis", {
      reactMajorVersion: 17,
    });
    expect(hits).toHaveLength(0);
  });

  it("DOES flag react-dom render on React 18 projects (deprecated since 18)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r18-render", {
      reactVersion: "^18.3.1",
      files: {
        "src/main.tsx": `import { render } from "react-dom";

void render;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis", {
      reactMajorVersion: 18,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("DOES flag react-dom render on React 19 projects", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r19-render", {
      reactVersion: "^19.0.0",
      files: {
        "src/main.tsx": `import { render } from "react-dom";

void render;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis", {
      reactMajorVersion: 19,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag react-dom render when the React version is unknown", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-null-render", {
      reactVersion: "*",
      files: {
        "src/main.tsx": `import { render } from "react-dom";

void render;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-react-dom-deprecated-apis", {
      reactMajorVersion: null,
    });
    expect(hits).toHaveLength(0);
  });

  it("STILL flags legacy lifecycles regardless of React version (warned since 16.3)", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-r17-lifecycle", {
      reactVersion: "^17.0.2",
      files: {
        "src/Legacy.tsx": `import React from "react";

export class Legacy extends React.Component<{}, {}> {
  componentWillMount() {}
  render() { return null; }
}
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles", {
      reactMajorVersion: 17,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag React-19-only defaultProps migration when the React version is unknown", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-null-defaultProps", {
      reactVersion: "*",
      files: {
        "src/Button.tsx": `export const Button = ({ size }: { size?: string }) => <button data-size={size} />;
Button.defaultProps = { size: "md" };
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-default-props", { reactMajorVersion: null });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag prefer-use-effect-event when the React version is unknown", async () => {
    const projectDir = setupReactProject(tempRoot, "gating-null-prefer-use-effect-event", {
      reactVersion: "*",
      files: {
        "src/Search.tsx": `import { useEffect, useState } from "react";

export const Search = ({ onChange }: { onChange: (value: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return <input value={text} onChange={(event) => setText(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", {
      reactMajorVersion: null,
    });
    expect(hits).toHaveLength(0);
  });
});
