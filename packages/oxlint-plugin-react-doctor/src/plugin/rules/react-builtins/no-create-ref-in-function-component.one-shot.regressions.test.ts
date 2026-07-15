import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const runOneShotRule = (source: string) =>
  runRule(noCreateRefInFunctionComponent, source, {
    filename: "src/core/Modal/Modal/Modal.test.tsx",
  });

describe("no-create-ref-in-function-component — proven RTL mount lifecycles", () => {
  it("stays silent for the authentic Suomi one-shot focus harness", () => {
    const result = runOneShotRule(`import React from "react";
import { render, waitFor } from "@testing-library/react";
import { Modal } from "./Modal";

it("focuses the requested button", async () => {
  const ModalWithFocusOnOpenRef = (props?: Record<string, unknown>) => {
    const buttonRef = React.createRef<HTMLButtonElement>();
    return (
      <Modal focusOnOpenRef={buttonRef} {...props}>
        <button ref={buttonRef}>Test button 2</button>
      </Modal>
    );
  };

  const { getByText } = render(<ModalWithFocusOnOpenRef />);
  await waitFor(() => expect(getByText("Test button 2")).toHaveFocus());
});`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes renamed and namespace Testing Library render imports", () => {
    const renamedResult = runOneShotRule(`import React from "react";
import { render as mount } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  mount(<FocusTarget />);
});`);
    const namespaceResult = runOneShotRule(`import React from "react";
import * as TestingLibrary from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
test("mounts", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  TestingLibrary["render"](<FocusTarget />);
});`);
    expect(renamedResult.diagnostics).toEqual([]);
    expect(namespaceResult.diagnostics).toEqual([]);
  });

  it("stays silent under binding-proven StrictMode because one render result is discarded", () => {
    const result = runOneShotRule(`import React, { StrictMode as DevelopmentChecks } from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts strictly", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  render(<DevelopmentChecks><FocusTarget /></DevelopmentChecks>);
});`);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for independent default-container roots", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts separate instances", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  render(<FocusTarget />);
  render(<FocusTarget />);
});`);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent through transparent TypeScript render wrappers", () => {
    const renderStatements = [
      `render((((<FocusTarget />))));`,
      `render((<FocusTarget />) as React.ReactElement);`,
      `render(<FocusTarget /> satisfies React.ReactElement);`,
      `render((<FocusTarget />)!);`,
    ];
    for (const renderStatement of renderStatements) {
      const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts a type-wrapped node", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  ${renderStatement}
});`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("reports nontransparent render argument transforms", () => {
    const renderStatements = [
      `render((observeRender(), <FocusTarget />));`,
      `render(condition ? <FocusTarget /> : <FocusTarget />);`,
      `render([<FocusTarget />]);`,
      `render(wrap(<FocusTarget />));`,
      `const mounted = <FocusTarget />; render(mounted as React.ReactElement);`,
    ];
    for (const renderStatement of renderStatements) {
      const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts a transformed node", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  ${renderStatement}
});`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports a same-root Testing Library rerender", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("rerenders", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const mounted = <FocusTarget />;
  const { rerender } = render(mounted);
  rerender(mounted);
});`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the render result can expose rerender", () => {
    const escapedResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("escapes the result", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const renderResult = render(<FocusTarget />);
  consume(renderResult);
});`);
    const restResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("captures every render method", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const { getByText, ...renderMethods } = render(<FocusTarget />);
  consume(getByText, renderMethods);
});`);
    expect(escapedResult.diagnostics).toHaveLength(1);
    expect(restResult.diagnostics).toHaveLength(1);
  });

  it("accepts renamed query bindings but reports executable result defaults", () => {
    const renamedResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("renames a query", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const { getByText: query } = render(<FocusTarget />);
  void query;
});`);
    const defaultResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("runs a result default", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const { missing = rerenderRoot() } = render(<FocusTarget />);
  void missing;
});`);
    expect(renamedResult.diagnostics).toEqual([]);
    expect(defaultResult.diagnostics).toHaveLength(1);
  });

  it("reports render options that can reuse or wrap the root", () => {
    const sources = [
      `const container = document.createElement("div"); render(<FocusTarget />, { container });`,
      `render(<FocusTarget />, { wrapper: TestProvider });`,
      `render(<FocusTarget />, { hydrate: true });`,
    ];
    for (const renderStatement of sources) {
      const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts with options", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  ${renderStatement}
});`);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports conditional and loop-owned render calls", () => {
    const conditionalResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts conditionally", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  if (condition) render(<FocusTarget />);
});`);
    const loopResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts in a loop", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  for (const item of items) render(<FocusTarget key={item} />);
});`);
    expect(conditionalResult.diagnostics).toHaveLength(1);
    expect(loopResult.diagnostics).toHaveLength(1);
  });

  it("reports local aliases and JSX aliases outside the direct proof", () => {
    const renderAliasResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts through an alias", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const mount = render;
  mount(<FocusTarget />);
});`);
    const jsxAliasResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts an aliased node", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const mounted = <FocusTarget />;
  render(mounted);
});`);
    const componentAliasResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts a component alias", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const AliasedTarget = FocusTarget;
  render(<AliasedTarget />);
});`);
    expect(renderAliasResult.diagnostics).toHaveLength(1);
    expect(jsxAliasResult.diagnostics).toHaveLength(1);
    expect(componentAliasResult.diagnostics).toHaveLength(1);
  });

  it("reports custom, reexported, destructured-namespace, and shadowed render functions", () => {
    const sources = [
      `import { render } from "./test-utils";`,
      `import * as TestingLibrary from "@testing-library/react"; const { render } = TestingLibrary;`,
      `const render = (node: React.ReactNode) => customMount(node);`,
      `import { render as rtlRender } from "@testing-library/react"; const render = rtlRender.bind(null);`,
    ];
    for (const renderDeclaration of sources) {
      const result = runOneShotRule(`import React from "react";
${renderDeclaration}
import { FocusTrap } from "./focus-trap";
it("mounts through unknown code", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  render(<FocusTarget />);
});`);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports wrapper render helpers", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts through a helper", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  const mount = (node: React.ReactNode) => render(node);
  mount(<FocusTarget />);
});`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports stateful, contextual, custom-hook, and unknown-call components", () => {
    const componentBodies = [
      `const [count, setCount] = React.useState(0); React.useEffect(() => setCount(1), []);`,
      `const theme = React.useContext(ThemeContext); void theme;`,
      `const snapshot = useExternalStore(); void snapshot;`,
      `observeRender();`,
    ];
    for (const extraBody of componentBodies) {
      const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts a rerenderable component", () => {
  const FocusTarget = () => {
    ${extraBody}
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  render(<FocusTarget />);
});`);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports executable or complex component parameters", () => {
    const parameterLists = [
      `(props = observeRender())`,
      `({ target = observeRender() } = {})`,
      `({ target }: { target?: string })`,
      `(...props: unknown[])`,
    ];
    for (const parameterList of parameterLists) {
      const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("mounts a component with complex parameters", () => {
  const FocusTarget = ${parameterList} => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  render(<FocusTarget />);
});`);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports render-side ref escapes without a call", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
let observedRef: React.RefObject<HTMLButtonElement> | null = null;
it("exposes the ref", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    observedRef = targetRef;
    return <button ref={targetRef}>Target</button>;
  };
  render(<FocusTarget />);
});`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports nested callbacks that can observe the ref after attachment", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
it("mounts an interactive component", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    const handleFocus = () => targetRef.current?.focus();
    return <button ref={targetRef} onClick={handleFocus}>Target</button>;
  };
  render(<FocusTarget />);
});`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports createRoot and hydrateRoot lifecycles", () => {
    const createRootResult = runOneShotRule(`import React from "react";
import { createRoot } from "react-dom/client";
import { FocusTrap } from "./focus-trap";
it("mounts a root", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  createRoot(container).render(<FocusTarget />);
});`);
    const hydrateRootResult = runOneShotRule(`import React from "react";
import { hydrateRoot } from "react-dom/client";
import { FocusTrap } from "./focus-trap";
it("hydrates a root", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  hydrateRoot(container, <FocusTarget />);
});`);
    expect(createRootResult.diagnostics).toHaveLength(1);
    expect(hydrateRootResult.diagnostics).toHaveLength(1);
  });

  it("reports shared declarations and any additional component reference escape", () => {
    const sharedResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
const FocusTarget = () => {
  const targetRef = React.createRef<HTMLButtonElement>();
  return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
};
it("mounts", () => render(<FocusTarget />));`);
    const escapedResult = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";
it("registers the component", () => {
  const FocusTarget = () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return <FocusTrap targetRef={targetRef}><button ref={targetRef}>Target</button></FocusTrap>;
  };
  registerFixture(FocusTarget);
  render(<FocusTarget />);
});`);
    expect(sharedResult.diagnostics).toHaveLength(1);
    expect(escapedResult.diagnostics).toHaveLength(1);
  });

  it("reports the byte-equivalent product component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React from "react";
import { Modal } from "./Modal";
export const ModalWithFocusOnOpenRef = () => {
  const buttonRef = React.createRef<HTMLButtonElement>();
  return <Modal focusOnOpenRef={buttonRef}><button ref={buttonRef}>Target</button></Modal>;
};`,
      { filename: "src/core/Modal/Modal/Modal.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps useRef clean in the authentic harness", () => {
    const result = runOneShotRule(`import React from "react";
import { render } from "@testing-library/react";
import { Modal } from "./Modal";
it("focuses", () => {
  const FocusTarget = () => {
    const targetRef = React.useRef<HTMLButtonElement>(null);
    return <Modal focusOnOpenRef={targetRef}><button ref={targetRef}>Target</button></Modal>;
  };
  render(<FocusTarget />);
});`);
    expect(result.diagnostics).toEqual([]);
  });
});
