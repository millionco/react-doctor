import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface ImportedControlFixture {
  readonly name: string;
  readonly source: string;
  readonly producer: string;
  readonly expectedCount: number;
  readonly files?: Readonly<Record<string, string>>;
}

const importedControlCallerSource = `import { useState } from "react";
import { ActionControl } from "./action-control";
export const Editor = () => {
  const [, setIssue] = useState(null);
  const save = async () => {
    await fetch("/records", { method: "POST" });
    setIssue("updated");
  };
  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;
};`;

const nativeControlProducerSource = `import { forwardRef } from "react";
export const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>
  <button ref={forwardedRef} {...nativeProps}>{children}</button>
);`;

const polymorphicControlProducerSource = `import * as React from "react";
const Alternate = () => null;
export const ActionControl = React.forwardRef(
  ({ disabled, pending = false, asChild = false, children, ...nativeProps }, forwardedRef) => {
    const Element = asChild ? Alternate : "button";
    return <Element ref={forwardedRef} disabled={disabled || pending} {...nativeProps}>{children}</Element>;
  }
);
ActionControl.displayName = "ActionControl";`;

const fixtures: readonly ImportedControlFixture[] = [
  {
    name: "follows a first-party native rest-forwarding control",
    source: importedControlCallerSource,
    producer: nativeControlProducerSource,
    expectedCount: 1,
  },
  {
    name: "preserves a selected false polymorphic and loading default",
    source: importedControlCallerSource,
    producer: polymorphicControlProducerSource,
    expectedCount: 1,
  },
  {
    name: "follows a readonly named barrel",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./barrel";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 1,
    files: {
      "barrel.ts": 'export { ActionControl } from "./action-control";',
    },
  },
  {
    name: "supports a named default export",
    source:
      'import { useState } from "react";\nimport ActionControl from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer:
      'import { forwardRef } from "react";\nconst ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n);\nexport default ActionControl;',
    expectedCount: 1,
  },
  {
    name: "supports a named inline renderer without its own escapes",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(function RenderControl({ children, ...nativeProps }, forwardedRef) {\n  return <button ref={forwardedRef} {...nativeProps}>{children}</button>;\n});',
    expectedCount: 1,
  },
  {
    name: "handles a transparent typed factory initializer",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = (forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n) as any);',
    expectedCount: 1,
  },
  {
    name: "reports catch-only state after a mutating request",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    setIssue(null);\n    try { await fetch("/records", { method: "POST" }); }\n    catch { setIssue("failed"); }\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 1,
  },
  {
    name: "keeps the existing leading ref guard quiet",
    source:
      'import { useRef, useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const pending = useRef(false);\n  const save = async () => {\n    if (pending.current) return;\n    pending.current = true;\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "does not broaden the mutating request predicate",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "GET" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "does not broaden the post-await state predicate",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines a selected custom polymorphic branch",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false} asChild={true}>Save</ActionControl>;\n};',
    producer: polymorphicControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines an unknown polymorphic branch",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false} asChild={chooseCustom}>Save</ActionControl>;\n};',
    producer: polymorphicControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines a selected loading control",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false} pending={true}>Save</ActionControl>;\n};',
    producer: polymorphicControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines unknown loading state",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false} pending={working}>Save</ActionControl>;\n};',
    producer: polymorphicControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines a statically disabled selected instance",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={true}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines unknown caller spreads",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl {...otherProps} onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines duplicate selected event props",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines an explicit callback replacement",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps} onClick={() => null}>{children}</button>\n);',
    expectedCount: 0,
  },
  {
    name: "declines a props-rest escape",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) => {\n  const captured = record(nativeProps);\n  return <button ref={forwardedRef} {...nativeProps}>{children}</button>;\n});',
    expectedCount: 0,
  },
  {
    name: "declines a native ref escape",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) => {\n  const captured = record(forwardedRef);\n  return <button ref={forwardedRef} {...nativeProps}>{children}</button>;\n});',
    expectedCount: 0,
  },
  {
    name: "declines multiple props-rest publications",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps} {...nativeProps}>{children}</button>\n);',
    expectedCount: 0,
  },
  {
    name: "declines an inverted disabled transport",
    source: importedControlCallerSource,
    producer:
      'import * as React from "react";\nconst Alternate = () => null;\nexport const ActionControl = React.forwardRef(\n  ({ disabled, pending = false, asChild = false, children, ...nativeProps }, forwardedRef) => {\n    const Element = asChild ? Alternate : "button";\n    return <Element ref={forwardedRef} disabled={!disabled} {...nativeProps}>{children}</Element>;\n  }\n);\nActionControl.displayName = "ActionControl";',
    expectedCount: 0,
  },
  {
    name: "declines visible component defaults mutation",
    source: importedControlCallerSource,
    producer:
      'import * as React from "react";\nconst Alternate = () => null;\nexport const ActionControl = React.forwardRef(\n  ({ disabled, pending = false, asChild = false, children, ...nativeProps }, forwardedRef) => {\n    const Element = asChild ? Alternate : "button";\n    return <Element ref={forwardedRef} disabled={disabled || pending} {...nativeProps}>{children}</Element>;\n  }\n);\nActionControl.displayName = "ActionControl";\nActionControl.defaultProps = { asChild: true };',
    expectedCount: 0,
  },
  {
    name: "declines a sibling imported component alias mutation",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nimport { ActionControl as OtherControl } from "./action-control";\nOtherControl.defaultProps = { disabled: true };\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
  {
    name: "declines visible mutation in a reexport context",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./barrel";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 0,
    files: {
      "barrel.ts":
        'import { ActionControl as Other } from "./action-control"; Other.defaultProps={disabled:true}; export { ActionControl } from "./action-control";',
    },
  },
  {
    name: "declines an unproven forwardRef provider",
    source: importedControlCallerSource,
    producer:
      "const forwardRef = (render) => foreign(render);\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n);",
    expectedCount: 0,
  },
  {
    name: "declines a mutated shared React factory",
    source: importedControlCallerSource,
    producer:
      'import * as React from "react";\nReact.forwardRef = foreign;\nconst Alternate = () => null;\nexport const ActionControl = React.forwardRef(\n  ({ disabled, pending = false, asChild = false, children, ...nativeProps }, forwardedRef) => {\n    const Element = asChild ? Alternate : "button";\n    return <Element ref={forwardedRef} disabled={disabled || pending} {...nativeProps}>{children}</Element>;\n  }\n);\nActionControl.displayName = "ActionControl";',
    expectedCount: 0,
  },
  {
    name: "declines a local classic JSX factory",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nconst React = { createElement: () => null };\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n);',
    expectedCount: 0,
    files: {
      "tsconfig.json": '{"compilerOptions": {"jsx": "react"}}',
    },
  },
  {
    name: "declines a render parameter classic JSX factory",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ React = { createElement: () => null }, children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n);',
    expectedCount: 0,
    files: {
      "tsconfig.json": '{"compilerOptions": {"jsx": "react"}}',
    },
  },
  {
    name: "declines a render-local classic JSX factory",
    source: importedControlCallerSource,
    producer:
      'import { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) => {\n  const React = { createElement: () => null };\n  return <button ref={forwardedRef} {...nativeProps}>{children}</button>;\n});',
    expectedCount: 0,
    files: {
      "tsconfig.json": '{"compilerOptions": {"jsx": "react"}}',
    },
  },
  {
    name: "declines an explicit custom JSX runtime",
    source: importedControlCallerSource,
    producer: nativeControlProducerSource,
    expectedCount: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "jsxImportSource": "foreign-jsx"}}',
    },
  },
  {
    name: "declines a custom file pragma",
    source: importedControlCallerSource,
    producer:
      '/** @jsx foreignFactory */\nimport { forwardRef } from "react";\nexport const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>\n  <button ref={forwardedRef} {...nativeProps}>{children}</button>\n);',
    expectedCount: 0,
  },
  {
    name: "preserves the existing direct native branch",
    source:
      'import { useState } from "react";\nimport { ActionControl } from "./action-control";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <button onClick={save} disabled={false}>Save</button>;\n};',
    producer: nativeControlProducerSource,
    expectedCount: 1,
  },
  {
    name: "follows a first-party native form submit prop",
    source: importedControlCallerSource.replace("onClick", "onSubmit"),
    producer: nativeControlProducerSource.replaceAll("button", "form"),
    expectedCount: 1,
  },
  {
    name: "declines a submit prop forwarded to a button instead of a form",
    source: importedControlCallerSource.replace("onClick", "onSubmit"),
    producer: nativeControlProducerSource,
    expectedCount: 0,
  },
];

describe("no-async-event-handler-without-reentry-guard imported controls", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "async-control-"));
      const filename = path.join(directory, "editor.tsx");
      try {
        fs.writeFileSync(
          path.join(directory, "package.json"),
          JSON.stringify({ dependencies: { react: "^18.2.0" } }),
        );
        fs.writeFileSync(
          path.join(directory, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
        );
        fs.writeFileSync(path.join(directory, "action-control.tsx"), fixture.producer);
        for (const [relativePath, body] of Object.entries(fixture.files ?? {}))
          fs.writeFileSync(path.join(directory, relativePath), body);
        fs.writeFileSync(filename, fixture.source);
        resetFilesystemCaches();
        const result = runRule(noAsyncEventHandlerWithoutReentryGuard, fixture.source, {
          filename,
          includeLocations: true,
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(fixture.expectedCount);
      } finally {
        resetFilesystemCaches();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("records producer and barrel probes and refreshes a changed producer between lint passes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "async-control-probes-"));
    const filename = path.join(directory, "editor.tsx");
    const producerPath = path.join(directory, "action-control.tsx");
    const barrelPath = path.join(directory, "barrel.ts");
    const source =
      'import { useState } from "react";\nimport { ActionControl } from "./barrel";\nexport const Editor = () => {\n  const [, setIssue] = useState(null);\n  const save = async () => {\n    await fetch("/records", { method: "POST" });\n    setIssue("updated");\n  };\n  return <ActionControl onClick={save} disabled={false}>Save</ActionControl>;\n};';
    const producer = nativeControlProducerSource;
    try {
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.2.0" } }),
      );
      fs.writeFileSync(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      );
      fs.writeFileSync(producerPath, producer);
      fs.writeFileSync(barrelPath, 'export { ActionControl } from "./action-control";');
      fs.writeFileSync(filename, source);
      resetFilesystemCaches();
      const initial = captureCrossFileProbes(() =>
        runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename }),
      );
      expect(initial.value.parseErrors).toEqual([]);
      expect(initial.value.diagnostics).toHaveLength(1);
      expect([...initial.trace.contentPaths]).toContain(producerPath);
      expect([...initial.trace.contentPaths]).toContain(barrelPath);
      fs.writeFileSync(
        producerPath,
        producer + "\nActionControl.defaultProps = { disabled: true };",
      );
      resetFilesystemCaches();
      const changed = runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename });
      expect(changed.parseErrors).toEqual([]);
      expect(changed.diagnostics).toHaveLength(0);
      fs.writeFileSync(producerPath, producer);
      resetFilesystemCaches();
      expect(
        runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename }).diagnostics,
      ).toHaveLength(1);
      expect(fs.readFileSync(filename, "utf8")).toBe(source);
    } finally {
      resetFilesystemCaches();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refreshes direct JSX configuration while caller and producer stay unchanged", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "async-control-config-"));
    const filename = path.join(directory, "editor.tsx");
    const configPath = path.join(directory, "tsconfig.json");
    const source = importedControlCallerSource;
    const producer = nativeControlProducerSource;
    try {
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.2.0" } }),
      );
      fs.writeFileSync(path.join(directory, "action-control.tsx"), producer);
      fs.writeFileSync(filename, source);
      fs.writeFileSync(configPath, JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
      resetFilesystemCaches();
      expect(
        runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename }).diagnostics,
      ).toHaveLength(1);
      fs.writeFileSync(
        configPath,
        JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "foreign-jsx" } }),
      );
      resetFilesystemCaches();
      expect(
        runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename }).diagnostics,
      ).toHaveLength(0);
      fs.writeFileSync(configPath, JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
      resetFilesystemCaches();
      expect(
        runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename }).diagnostics,
      ).toHaveLength(1);
      expect(fs.readFileSync(filename, "utf8")).toBe(source);
      expect(fs.readFileSync(path.join(directory, "action-control.tsx"), "utf8")).toBe(producer);
    } finally {
      resetFilesystemCaches();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
