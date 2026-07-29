import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";

const RULE_ID = "no-create-ref-in-function-component";
const CREATE_REF_DIAGNOSTIC_MESSAGE =
  "`createRef()` may escape or be observed beyond the render that created it, so a later render can replace the ref object and detach the observed one. Hoist a `useRef()` call to the component's unconditional top level instead.";

const PROJECT_FILES = new Map<string, string>([
  [
    "src/use-forward-focus.ts",
    `import { useImperativeHandle, useRef } from "react";

export default function useForwardFocus(mainRef) {
  const controlRef = useRef(null);
  useImperativeHandle(
    mainRef,
    () => ({ focus: () => controlRef.current?.focus() }),
    [controlRef],
  );
  return controlRef;
}`,
  ],
  [
    "src/internal-button.tsx",
    `import React from "react";
import useForwardFocus from "./use-forward-focus";

const InternalButtonImplementation = (props, ref) => {
  const controlRef = useForwardFocus(ref);
  return <button {...props} ref={controlRef} />;
};

export const InternalButton = React.forwardRef(InternalButtonImplementation);`,
  ],
  [
    "src/navigation-implementations.tsx",
    `import { useLayoutEffect } from "react";
import { InternalButton } from "./internal-button";

export const SafeNavigation = ({ target }) => (
  <InternalButton ref={target}>Focus</InternalButton>
);

export const ObservedNavigation = ({ target }) => {
  useLayoutEffect(() => {
    globalThis.observedRef = target;
  }, []);
  return <InternalButton ref={target}>Focus</InternalButton>;
};`,
  ],
  [
    "src/navigation/index.ts",
    `export { ObservedNavigation, SafeNavigation } from "../navigation-implementations";`,
  ],
  [
    "src/safe-adapter.tsx",
    `import { createRef } from "react";
import { SafeNavigation } from "./navigation";

export const SafeAdapter = () => {
  const target = createRef();
  return <SafeNavigation target={target} />;
};`,
  ],
  [
    "src/observed-adapter.tsx",
    `import { createRef } from "react";\r
import { ObservedNavigation } from "./navigation";\r
\r
export const ObservedAdapter = () => {\r
  "🔭";\r
  const target = createRef();\r
  return <ObservedNavigation target={target} />;\r
};`,
  ],
  [
    "src/missing-adapter.tsx",
    `import { createRef } from "react";
import { MissingNavigation } from "./missing-navigation";

export const MissingAdapter = () => {
  const target = createRef();
  return <MissingNavigation target={target} />;
};`,
  ],
  [
    "src/intrinsic-adapter.tsx",
    `import { createRef } from "react";

export const IntrinsicAdapter = () => {
  const target = createRef();
  return <button ref={target}>Focus</button>;
};`,
  ],
  ["src/invalid.tsx", "export const ="],
]);

const temporaryDirectories: string[] = [];

describe("createRef project evaluation", () => {
  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps imported ref flow exactly aligned", () => {
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-create-ref-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    for (const [filename, sourceText] of PROJECT_FILES) {
      const absoluteFilename = path.join(temporaryRootDirectory, filename);
      fs.mkdirSync(path.dirname(absoluteFilename), { recursive: true });
      fs.writeFileSync(absoluteFilename, sourceText, "utf8");
    }

    const realResult = evaluateProject({
      files: PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: [RULE_ID],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-create-ref-project",
      files: PROJECT_FILES,
      ruleIds: [RULE_ID],
    });

    expect(virtualResult).toEqual(realResult);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, rule, message, line, column, offset, length, endLine, endColumn }) => ({
          filePath,
          rule,
          message,
          line,
          column,
          offset,
          length,
          endLine,
          endColumn,
        }),
      ),
    ).toEqual([
      {
        filePath: "src/observed-adapter.tsx",
        rule: RULE_ID,
        message: CREATE_REF_DIAGNOSTIC_MESSAGE,
        line: 6,
        column: 18,
        offset: 158,
        length: 11,
        endLine: 6,
        endColumn: 29,
      },
      {
        filePath: "src/missing-adapter.tsx",
        rule: RULE_ID,
        message: CREATE_REF_DIAGNOSTIC_MESSAGE,
        line: 5,
        column: 18,
        offset: 149,
        length: 11,
        endLine: 5,
        endColumn: 29,
      },
    ]);
    expect(virtualResult.failures).toEqual([
      {
        kind: "parse",
        filePath: "src/invalid.tsx",
        message: "Unexpected token",
        line: 1,
        column: 14,
        offset: 13,
        length: 1,
      },
    ]);
    expect(
      virtualResult.diagnostics.filter((diagnostic) =>
        ["src/safe-adapter.tsx", "src/intrinsic-adapter.tsx"].includes(diagnostic.filePath),
      ),
    ).toEqual([]);
  });

  it("keeps source-only evaluation explicitly unsupported", () => {
    expect(
      evaluateSource({
        sourceText: `export const Component = () => <div ref={createRef()} />;`,
        filename: "src/component.tsx",
        ruleIds: [RULE_ID],
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "unsupported-rule",
          filePath: "src/component.tsx",
          rule: RULE_ID,
          message: `Rule requires a project host: ${RULE_ID}`,
        },
      ],
    });
  });
});
