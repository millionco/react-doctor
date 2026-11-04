import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFlushSync } from "./no-flush-sync.js";

interface InitialRootCase {
  name: string;
  source: string;
}

const imports = `import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";`;

const precomputedNodeSource = "const widgetElement = <div />;\n";

const validCases: InitialRootCase[] = [
  {
    name: "a precomputed parameter node",
    source: `${imports}
const initializeWidget = (container, element) => {
  const root = createRoot(container);
  flushSync(() => root.render(element));
};`,
  },
  {
    name: "an imported precomputed node",
    source: `${imports}
import element from "widget-node";
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(element));
};`,
  },
  ...['"Ready"', "42", "true", "null"].map(
    (nodeExpression): InitialRootCase => ({
      name: `a primitive literal node ${nodeExpression}`,
      source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(${nodeExpression}));
};`,
    }),
  ),
  {
    name: "a direct private function declaration",
    source: `${imports}
function initializeWidget() {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
}
initializeWidget();`,
  },
  {
    name: "a wrapped readonly function initializer",
    source: `${imports}
const initializeWidget = (() => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
}) as () => void;
initializeWidget();`,
  },
  {
    name: "an immediately invoked setup function",
    source: `${imports}
(() => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
})();`,
  },
  {
    name: "a private initializer called from module setup",
    source: `${imports}
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
initializeWidget();`,
  },
  {
    name: "precomputed nested JSX and fragments",
    source: `${imports}
const initializeWidget = (container, title) => {
  const element = <><Widget title={title} /><span>Ready</span></>;
  const root = createRoot(container);
  flushSync(() => root.render(element));
};`,
  },
  {
    name: "an imperative adapter's initial render",
    source: `${imports}
const initializeWidget = (container, element) => {
  const root = createRoot(container);
  flushSync(() => { root.render(element); });
};`,
  },
  {
    name: "a top-level initial render",
    source: `${imports}
const root = createRoot(container);
flushSync(() => root.render(widgetElement));`,
  },
  {
    name: "named import aliases",
    source: `import { createRoot as createWidgetRoot } from "react-dom/client";
import { flushSync as commitImmediately } from "react-dom";
const initializeWidget = (container) => {
  const root = createWidgetRoot(container);
  commitImmediately(() => root.render(widgetElement));
};`,
  },
  {
    name: "a ReactDOM client namespace",
    source: `import * as ReactDomClient from "react-dom/client";
import { flushSync } from "react-dom";
const initializeWidget = (container) => {
  const root = ReactDomClient.createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "transparent TypeScript wrappers",
    source: `${imports}
const initializeWidget = (container) => {
  const root = (createRoot(container));
  flushSync(() => (root!).render(widgetElement));
};`,
  },
  {
    name: "a precomputed element with work outside the flush",
    source: `${imports}
const initializeWidget = (container) => {
  const element = <Widget value={readConfiguration()} />;
  const root = createRoot(container);
  flushSync(() => { root.render(element); });
};`,
  },
];

const invalidCases: InitialRootCase[] = [
  {
    name: "inline JSX with factory evaluation inside the flush",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(<Widget />));
};`,
  },
  {
    name: "a JSX key with implicit object coercion",
    source: `${imports}
let counter = 0;
const initializeWidget = (container) => {
  const keyValue = { toString() { counter++; return "key"; } };
  const root = createRoot(container);
  flushSync(() => root.render(<Widget key={keyValue} />));
};`,
  },
  {
    name: "an unbound argument that may read a global getter",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(globalNode));
};`,
  },
  {
    name: "an ambient argument without a local runtime initializer",
    source: `${imports}
declare const element: React.ReactNode;
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(element));
};`,
  },
  {
    name: "a const argument declared after the render",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(element));
  const element = <Widget />;
};`,
  },
  {
    name: "a type-only node import",
    source: `${imports}
import type { element } from "widget-node";
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(element));
};`,
  },
  {
    name: "an object-valued regular expression literal",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(/node/));
};`,
  },
  {
    name: "an anonymous initializer returned to an Effect",
    source: `${imports}
import { useEffect } from "react";
const createInitializer = () => {
  return () => {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  };
};
const initialize = createInitializer();
function Screen() { useEffect(initialize, []); return null; }`,
  },
  {
    name: "a concise factory returning an Effect initializer",
    source: `${imports}
import { useEffect } from "react";
const createInitializer = () => () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
const initialize = createInitializer();
function Screen() { useEffect(initialize, []); return null; }`,
  },
  {
    name: "a returned named function with an unused self binding",
    source: `${imports}
import { useEffect } from "react";
const createInitializer = () => {
  return function initializeRoot() {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  };
};
const initialize = createInitializer();
function Screen() { useEffect(initialize, []); return null; }`,
  },
  {
    name: "an array-contained function passed to an Effect",
    source: `${imports}
import { useEffect } from "react";
const initializers = [() => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
}];
function Screen() { useEffect(initializers[0], []); return null; }`,
  },
  {
    name: "a conditional function passed to an Effect",
    source: `${imports}
import { useEffect } from "react";
const initialize = condition ? () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
} : unrelated;
function Screen() { useEffect(initialize, []); return null; }`,
  },
  {
    name: "an assigned function with an uncertified placement",
    source: `${imports}
let initialize;
initialize = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a generator whose body resumes inside an Effect",
    source: `${imports}
import { useEffect } from "react";
function* initializeWidget() {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  yield;
}
const iterator = initializeWidget();
function Screen() { useEffect(() => { iterator.next(); }, []); return null; }`,
  },
  {
    name: "an async initializer with unproved continuation timing",
    source: `${imports}
const initializeWidget = async () => {
  await ready;
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a function declaration escaping its own inner binding",
    source: `${imports}
function initializeWidget() {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  return initializeWidget;
}
const Component = initializeWidget();
const element = <Component />;`,
  },
  {
    name: "a named function expression escaping its own inner binding",
    source: `${imports}
const initializeWidget = function self() {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  return self;
};
const Component = initializeWidget();
const element = <Component />;`,
  },
  {
    name: "an unknown class method caller",
    source: `${imports}
class WidgetAdapter {
  initialize(container) {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  }
}`,
  },
  {
    name: "a class helper invoked during rendering",
    source: `${imports}
class Component extends React.Component {
  initialize() {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  }
  render() { this.initialize(); return null; }
}`,
  },
  {
    name: "a class helper invoked during a lifecycle method",
    source: `${imports}
class Component extends React.Component {
  initialize() {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  }
  componentDidMount() { this.initialize(); }
}`,
  },
  {
    name: "a JSX member tag with a potential getter",
    source: `${imports}
const initializeWidget = (container, registry) => {
  const root = createRoot(container);
  flushSync(() => root.render(<registry.Widget />));
};`,
  },
  {
    name: "template coercion inside the flush",
    source:
      imports +
      "\nconst initializeWidget = (container, value) => { const root = createRoot(container); flushSync(() => root.render(`${value}`)); };",
  },
  {
    name: "unary coercion inside the flush",
    source: `${imports}
const initializeWidget = (container, value) => {
  const root = createRoot(container);
  flushSync(() => root.render(+value));
};`,
  },
  {
    name: "binary coercion inside the flush",
    source: `${imports}
const initializeWidget = (container, value) => {
  const root = createRoot(container);
  flushSync(() => root.render(value + 1));
};`,
  },
  {
    name: "computed object-key coercion inside the flush",
    source: `${imports}
const initializeWidget = (container, key) => {
  const root = createRoot(container);
  flushSync(() => root.render(<Widget attributes={{ [key]: true }} />));
};`,
  },
  {
    name: "a function alias passed to an Effect",
    source: `${imports}
import { useEffect } from "react";
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
const alias = initializeWidget;
useEffect(alias, []);`,
  },
  {
    name: "a function aliased as a component",
    source: `${imports}
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
const Component = initializeWidget;
const element = <Component />;`,
  },
  {
    name: "a function escaped through an object property",
    source: `${imports}
import { useEffect } from "react";
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
const holder = { initializeWidget };
useEffect(holder.initializeWidget, []);`,
  },
  {
    name: "a function passed to an unknown caller",
    source: `${imports}
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
registerInitializer(initializeWidget);`,
  },
  {
    name: "a React ref callback during commit",
    source: `${imports}
const outer = createRoot(container);
outer.render(<div ref={(node) => {
  const inner = createRoot(node);
  flushSync(() => inner.render(widgetElement));
}} />);`,
  },
  {
    name: "an anonymous default-exported component",
    source: `${imports}
export default () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  return null;
};`,
  },
  {
    name: "an exported initializer with unknown callers",
    source: `${imports}
export const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a root passed to the rendered tree",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(<Widget root={root} />));
};`,
  },
  {
    name: "a later declarator escaping the new root",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container), configured = configureRoot(root);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a type-only provider import",
    source: `import type { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an uncertain default provider import",
    source: `import ReactDomClient from "react-dom/client";
import { flushSync } from "react-dom";
const initializeWidget = (container) => {
  const root = ReactDomClient.createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an unresolved member render argument",
    source: `${imports}
const initializeWidget = (container, configuration) => {
  const root = createRoot(container);
  flushSync(() => root.render(configuration.element));
};`,
  },
  {
    name: "an unknown root receiver",
    source: `${imports}
const initializeWidget = (root) => { flushSync(() => root.render(widgetElement)); };`,
  },
  {
    name: "a foreign createRoot API",
    source: `import { createRoot } from "widget-renderer";
import { flushSync } from "react-dom";
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a shadowed createRoot import",
    source: `${imports}
const initializeWidget = (createRoot, container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a shadowed flushSync import",
    source: `${imports}
const initializeWidget = (flushSync, container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a mutated namespace provider",
    source: `import * as ReactDomClient from "react-dom/client";
import { flushSync } from "react-dom";
ReactDomClient.createRoot = makeForeignRoot;
const initializeWidget = (container) => {
  const root = ReactDomClient.createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an escaped namespace provider",
    source: `import * as ReactDomClient from "react-dom/client";
import { flushSync } from "react-dom";
configureRenderer(ReactDomClient);
const initializeWidget = (container) => {
  const root = ReactDomClient.createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an escaped named provider",
    source: `${imports}
configureRenderer(createRoot);
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an uncertain provider alias",
    source: `${imports}
const createWidgetRoot = createRoot;
const initializeWidget = (container) => {
  const root = createWidgetRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an aliased root",
    source: `${imports}
const initializeWidget = (container) => {
  const originalRoot = createRoot(container);
  const root = originalRoot;
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a root escaped before rendering",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  configureRoot(root);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a root escaped after rendering",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  return root;
};`,
  },
  {
    name: "a root rendered previously",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  root.render(<EarlierWidget />);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a root rendered again later",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  root.render(<LaterWidget />);
};`,
  },
  {
    name: "a mutable root binding",
    source: `${imports}
const initializeWidget = (container) => {
  let root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "a replaced root render method",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  root.render = renderElsewhere;
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "unrelated work between construction and flushing",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  notifyWidgetCreated();
  flushSync(() => root.render(widgetElement));
};`,
  },
  {
    name: "an unrelated setter inside the callback",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => { setReady(true); root.render(widgetElement); });
};`,
  },
  {
    name: "unrelated work inside a JSX argument",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render(<Widget ready={setReady(true)} />));
};`,
  },
  {
    name: "a deferred render",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => queueMicrotask(() => root.render(widgetElement)));
};`,
  },
  {
    name: "an async render callback",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(async () => root.render(widgetElement));
};`,
  },
  {
    name: "an optional render call",
    source: `${imports}
const initializeWidget = (container) => {
  const root = createRoot(container);
  flushSync(() => root.render?.(<Widget />));
};`,
  },
  {
    name: "direct component rendering",
    source: `${imports}
const Component = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
  return null;
};`,
  },
  {
    name: "a custom Hook body",
    source: `${imports}
const useWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};`,
  },
  ...["useEffect", "useLayoutEffect", "useInsertionEffect", "useMemo", "useCallback"].map(
    (hookName): InitialRootCase => ({
      name: `a ${hookName} callback`,
      source: `${imports}
import { ${hookName} } from "react";
${hookName}(() => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
}, []);`,
    }),
  ),
  {
    name: "a named Effect callback",
    source: `${imports}
import { useEffect } from "react";
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
useEffect(initializeWidget, []);`,
  },
  {
    name: "a local helper invoked by an Effect",
    source: `${imports}
import { useEffect } from "react";
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
useEffect(() => { initializeWidget(); }, []);`,
  },
  {
    name: "a local helper invoked during component rendering",
    source: `${imports}
const initializeWidget = () => {
  const root = createRoot(container);
  flushSync(() => root.render(widgetElement));
};
const Component = () => { initializeWidget(); return null; };`,
  },
  {
    name: "a class lifecycle method",
    source: `${imports}
class Component extends React.Component {
  componentDidMount() {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  }
}`,
  },
  {
    name: "a class lifecycle field",
    source: `${imports}
class Component extends React.Component {
  componentDidUpdate = () => {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  };
}`,
  },
  {
    name: "a wrapped class lifecycle field",
    source: `${imports}
class Component extends React.Component {
  componentDidUpdate = (() => {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
  }) as () => void;
}`,
  },
  {
    name: "a class render method",
    source: `${imports}
class Component extends React.Component {
  render() {
    const root = createRoot(container);
    flushSync(() => root.render(widgetElement));
    return null;
  }
}`,
  },
];

describe("no-flush-sync initial root rendering", () => {
  it.each(validCases)("allows $name", ({ source }) => {
    const result = runRule(noFlushSync, precomputedNodeSource + source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(invalidCases)("still reports $name", ({ source }) => {
    const result = runRule(noFlushSync, precomputedNodeSource + source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
