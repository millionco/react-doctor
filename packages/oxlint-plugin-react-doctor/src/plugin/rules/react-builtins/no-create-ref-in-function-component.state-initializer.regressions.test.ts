import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const runCreateRefRule = (source: string) => runRule(noCreateRefInFunctionComponent, source);

describe("no-create-ref-in-function-component — stable state initializers", () => {
  it("stays silent for the four authentic Internxt useState forms", () => {
    const sources = [
      `import React, { useState } from "react";
export const Redirect = () => {
  const [anchorRef] = useState(React.createRef<HTMLAnchorElement>());
  return <a ref={anchorRef}>Open</a>;
};`,
      `import { createRef, useState } from "react";
export const GridItem = () => {
  const [itemRef] = useState(createRef<HTMLDivElement>());
  return <div ref={itemRef} />;
};`,
      `import { createRef, useState, type RefObject } from "react";
export const ChangePassword = () => {
  const [backupKeyInputRef] = useState<RefObject<HTMLInputElement>>(createRef());
  return <input ref={backupKeyInputRef} />;
};`,
      `import * as ReactRuntime from "react";
export const Skeleton = () => {
  const [itemRef] = ReactRuntime.useState(ReactRuntime.createRef<HTMLDivElement>());
  return <div ref={itemRef} />;
};`,
    ];
    for (const source of sources) {
      const result = runCreateRefRule(source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays silent for eager and inline lazy state initialization under StrictMode", () => {
    const result = runCreateRefRule(`import React, { StrictMode, createRef, useState } from "react";
const EagerTarget = () => {
  const [target] = useState(createRef<HTMLButtonElement>());
  return <button ref={target}>Eager</button>;
};
const LazyTarget = () => {
  const [target] = useState(function useInitialTargetRef() {
    return createRef<HTMLButtonElement>();
  });
  return <button ref={target}>Lazy</button>;
};
export const App = () => <StrictMode><EagerTarget /><LazyTarget /></StrictMode>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when every reference to a local initializer is a useState initializer", () => {
    const result = runCreateRefRule(`import React, { createRef, useState } from "react";
const useModuleInitialRef = () => createRef<HTMLDivElement>();
function useDeclaredInitialRef() {
  return createRef<HTMLDivElement>();
}
const ModuleTarget = () => {
  const [target] = useState(useModuleInitialRef);
  const [declaredTarget] = useState(useDeclaredInitialRef);
  return <><div ref={target} /><div ref={declaredTarget} /></>;
};
export const LocalTarget = () => {
  const useLocalInitialRef = () => createRef<HTMLButtonElement>();
  const [firstTarget] = useState(useLocalInitialRef);
  const [secondTarget] = React.useState(useLocalInitialRef);
  return <><button ref={firstTarget}>First</button><button ref={secondTarget}>Second</button></>;
};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves transparent wrappers around named lazy initializer functions and references", () => {
    const result =
      runCreateRefRule(`import React, { createRef, useState, type RefObject } from "react";
const useNamedInitialRef = ((function useWrappedInitialRef() {
  return createRef<HTMLButtonElement>();
}) as () => RefObject<HTMLButtonElement>);
const useArrowInitialRef = ((() => createRef<HTMLButtonElement>()) satisfies () => RefObject<HTMLButtonElement>);
export const Target = () => {
  const [namedTarget] = useState((useNamedInitialRef as () => RefObject<HTMLButtonElement>));
  const [arrowTarget] = useState(useArrowInitialRef satisfies () => RefObject<HTMLButtonElement>);
  return <><button ref={namedTarget}>Named</button><button ref={arrowTarget}>Arrow</button></>;
};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves React import, namespace, const, computed, and transparent aliases", () => {
    const result = runCreateRefRule(`import * as Runtime from "react";
import { createRef as makeRef, useState as preserveState } from "react";
const keep = preserveState;
export const NamedAlias = () => {
  const [target] = keep((makeRef<HTMLButtonElement>() as React.RefObject<HTMLButtonElement>));
  return <button ref={target}>Named</button>;
};
export const NamespaceAlias = () => {
  const [target] = Runtime["useState"]((Runtime["createRef"]<HTMLButtonElement>()));
  return <button ref={target}>Namespace</button>;
};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports direct createRef and non-state Hook initializers", () => {
    const sources = [
      `import { createRef } from "react";
export const Direct = ({ observe }) => {
  const target = createRef();
  observe(target);
  return <input ref={target} />;
};`,
      `import { createRef, useReducer } from "react";
export const Reduced = () => {
  const [target] = useReducer((state) => state, createRef());
  return <input ref={target} />;
};`,
    ];
    for (const source of sources) {
      const result = runCreateRefRule(source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("keeps useMemo reportable for empty, changing, omitted, and mutable dependencies", () => {
    const sources = [
      `import React from "react"; const Target = () => { const target = React.useMemo(() => React.createRef(), []); return <input ref={target} />; };`,
      `import React from "react"; const Target = ({ value }) => { const target = React.useMemo(() => React.createRef(), [value]); return <input ref={target} />; };`,
      `import React from "react"; const Target = () => { const target = React.useMemo(() => React.createRef()); return <input ref={target} />; };`,
      `import React from "react"; const Target = ({ value }) => { const dependencies = [value]; dependencies.push(value); const target = React.useMemo(() => React.createRef(), dependencies); return <input ref={target} />; };`,
    ];
    for (const source of sources) {
      const result = runCreateRefRule(source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not trust shadowed or similarly named state functions", () => {
    const localStateResult = runCreateRefRule(`import { createRef } from "react";
const useState = (value) => [value];
export const Target = () => {
  const [target] = useState(createRef());
  return <input ref={target} />;
};`);
    const shadowedNamespaceResult = runCreateRefRule(`import { createRef } from "react";
const Runtime = { useState: (value) => [value] };
export const Target = () => {
  const [target] = Runtime.useState(createRef());
  return <input ref={target} />;
};`);
    const localCreateRefResult = runCreateRefRule(`import { useState } from "react";
const createRef = () => ({ current: null });
export const Target = () => {
  const [target] = useState(createRef());
  return <input ref={target} />;
};`);
    expect(localStateResult.diagnostics).toHaveLength(1);
    expect(shadowedNamespaceResult.diagnostics).toHaveLength(1);
    expect(localCreateRefResult.diagnostics).toEqual([]);
  });

  it("reports named initializers with non-state, mutable, or ambiguous uses", () => {
    const sources = [
      `import { createRef, useState } from "react";
export const Target = () => {
  const useInitialRef = () => createRef();
  const [target] = useState(useInitialRef);
  const unstableTarget = useInitialRef();
  return <><input ref={target} /><input ref={unstableTarget} /></>;
};`,
      `import { createRef, useState } from "react";
export const Target = () => {
  let useInitialRef = () => createRef();
  const [target] = useState(useInitialRef);
  useInitialRef = () => ({ current: null });
  return <input ref={target} />;
};`,
      `import { createRef, useState } from "react";
export const Target = () => {
  const useInitialRef = () => createRef();
  observe(useInitialRef);
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
      `import { createRef } from "react";
const useState = (initializer) => [initializer()];
export const Target = () => {
  const useInitialRef = () => createRef();
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
      `import { createRef } from "react";
export const Target = () => run(function useInitialRef() {
  return createRef();
});`,
      `import { createRef, useState } from "react";
export const useInitialRef = () => createRef();
export const Target = () => {
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
      `import { createRef, useState } from "react";
export function useInitialRef() { return createRef(); }
export const Target = () => {
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
      `import { createRef, useState } from "react";
const useInitialRef = () => createRef();
export { useInitialRef };
export const Target = () => {
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
      `import { createRef, useState } from "react";
const useInitialRef = () => createRef();
export default useInitialRef;
export const Target = () => {
  const [target] = useState(useInitialRef);
  return <input ref={target} />;
};`,
    ];
    for (const source of sources) {
      const result = runCreateRefRule(source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });
});
