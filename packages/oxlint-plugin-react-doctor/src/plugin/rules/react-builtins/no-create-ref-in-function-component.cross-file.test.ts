import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "create-ref-write-only-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const writeForwardingModules = (navigationBody: string): string => {
  writeFile(
    "use-forward-focus.ts",
    `import { useImperativeHandle, useRef } from "react";

export default function useForwardFocus(mainRef) {
  const controlRef = useRef(null);
  useImperativeHandle(mainRef, () => ({ focus: () => controlRef.current?.focus() }), [controlRef]);
  return controlRef;
}`,
  );
  writeFile(
    "internal-button.tsx",
    `import React from "react";
import useForwardFocus from "./use-forward-focus";

const InternalButtonImplementation = (props, ref) => {
  const controlRef = useForwardFocus(ref);
  return <button {...props} ref={controlRef} />;
};

export const InternalButton = React.forwardRef(InternalButtonImplementation);`,
  );
  writeFile(
    "navigation.tsx",
    `import { useLayoutEffect } from "react";
import { InternalButton } from "./internal-button";

export function Navigation({ focusControl }) {
  ${navigationBody}
}`,
  );
  return writeFile(
    "pending-adapter.tsx",
    `import { createRef } from "react";
import { Navigation } from "./navigation";

export const PendingAdapter = ({ isPending }) => {
  if (!isPending) return <main>Ready</main>;
  const focusControl = {
    refs: {
      toggle: createRef(),
      close: createRef(),
      slider: createRef(),
    },
    setFocus: () => {},
    loseFocus: () => {},
  };
  return <Navigation focusControl={focusControl} />;
};`,
  );
};

describe("no-create-ref-in-function-component — cross-file write sinks", () => {
  it("stays silent when every imported consumer resolves to a React ref write sink", () => {
    const consumerPath = writeForwardingModules(
      "return <InternalButton ref={focusControl.refs.close}>Close</InternalButton>;",
    );
    const result = runRule(noCreateRefInFunctionComponent, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when an imported consumer retains and observes the ref", () => {
    const consumerPath = writeForwardingModules(
      `useLayoutEffect(() => {
    globalThis.observedRef = focusControl.refs.close;
  }, []);
  return <InternalButton ref={focusControl.refs.close}>Close</InternalButton>;`,
    );
    const result = runRule(noCreateRefInFunctionComponent, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when an imported consumer cannot be resolved", () => {
    const consumerPath = writeFile(
      "pending-adapter.tsx",
      `import { createRef } from "react";
import { Navigation } from "opaque-navigation";

export const PendingAdapter = () => {
  const target = createRef();
  return <Navigation target={target} />;
};`,
    );
    const result = runRule(noCreateRefInFunctionComponent, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
