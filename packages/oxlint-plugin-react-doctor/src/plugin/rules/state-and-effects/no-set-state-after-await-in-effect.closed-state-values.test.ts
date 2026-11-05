import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface StateValueContinuationCase {
  name: string;
  source: string;
  expectedWarnings: number;
}

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "react-doctor-state-values-baseline-"),
);
const cases: StateValueContinuationCase[] = [
  {
    name: "primitive-literal-control",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(true);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 0,
  },
  {
    name: "direct-fresh-record",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue({ pressed: true });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 0,
  },
  {
    name: "pure-identity-updater",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => previous);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 0,
  },
  {
    name: "closed-record-updater",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 0,
  },
  {
    name: "unknown-eager-updater",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => Boolean(notify(previous)));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "getter-record-state",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ get pressed() { notify(); return false; } });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "escaped-record-state",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  notify(value);\n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "unguarded-false-settlement",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      await pause(12, signal); setValue(true);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "reentry-after-barrier",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; notify(); setValue(true);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "async-identity",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(async previous => previous);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "defaulted-identity",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue((previous = false) => previous);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "identity-with-reentrant-prefix",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => { notify(); return previous; });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "identity-with-extra-parameter",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState(false);\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue((previous, unused) => previous);\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value ? "ready" : "waiting"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "other-writer-accessor",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  const replaceFromEvent = () => setValue({ get pressed() { notify(); return false; } });\n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <button onClick={replaceFromEvent}>{value.pressed ? "down" : "up"}</button>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "other-writer-proxy",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  const replaceFromEvent = () => setValue(new Proxy({ pressed: false }, { get: () => { notify(); return false; } }));\n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <button onClick={replaceFromEvent}>{value.pressed ? "down" : "up"}</button>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "retained-alias-accessor-mutation",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  const retained = value;\n  Object.defineProperty(retained, "pressed", { get: () => { notify(); return false; } });\n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...previous, pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "computed-key-coercion",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue({ [{ toString: () => { notify(); return "pressed"; } }]: true });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "literal-proto-key",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue({ __proto__: null, pressed: true });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "fresh-record-accessor",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue({ get pressed() { notify(); return true; } });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "fresh-record-method",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue({ pressed: () => notify() });\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
  {
    name: "spread-unknown-record",
    source:
      'import { useEffect, useState } from "react";\n\ninterface PanelProps {\n  readonly enabled: boolean;\n  readonly notify: (value?: unknown) => unknown;\n}\n\nconst pause = (duration: number, signal: AbortSignal) => new Promise<boolean>((settle) => {\n  if (signal.aborted) return settle(false);\n  const abort = () => { clearTimeout(timer); settle(false); };\n  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); settle(true); }, duration);\n  signal.addEventListener("abort", abort, { once: true });\n});\n\nexport const Panel = ({ enabled, notify }: PanelProps) => {\n  const [value, setValue] = useState({ pressed: false });\n  \n  useEffect(() => {\n    const controller = new AbortController();\n    const { signal } = controller;\n    const run = async () => {\n      if (!(await pause(12, signal))) return; setValue(previous => ({ ...notify(previous), pressed: true }));\n    };\n    void run();\n    return () => controller.abort();\n  }, [enabled]);\n  return <output>{value.pressed ? "down" : "up"}</output>;\n};\n',
    expectedWarnings: 1,
  },
];

beforeEach(() => {
  resetFilesystemCaches();
});

afterAll(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("closed state values continuation certificate", () => {
  it.each(cases)("$name", ({ name, source, expectedWarnings }) => {
    const directory = path.join(temporaryDirectory, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0" },
      }),
    );
    const filename = path.join(directory, "panel.tsx");
    fs.writeFileSync(filename, source);
    const result = runRule(noSetStateAfterAwaitInEffect, source, {
      filename,
      includeLocations: true,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedWarnings);
  });
});
