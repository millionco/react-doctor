import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("owned controller record loading resets", () => {
  it("record-controller-const-alias", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/00-record-controller-const-alias.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("record-renamed-destructuring", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller: requestController }) => requestController.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/01-record-renamed-destructuring.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("record-identifier-member-callback", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(entry => entry.controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/02-record-identifier-member-callback.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("record-single-expression-block", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => { controller.abort(); });
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/03-record-single-expression-block.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("record-missing-abort", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    void requests.current.size;
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/04-record-missing-abort.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-missing-clear", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    void requests.current.size;
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/05-record-missing-clear.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-reset-before-abort", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    setBusy(new Set());
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/06-record-reset-before-abort.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-conditional-abort", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    if (category === "stop") requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/07-record-conditional-abort.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-unrelated-key", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add("different"));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/08-record-unrelated-key.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-custom-controller", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = { signal: new AbortController().signal, abort: () => {} };
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/09-record-custom-controller.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-controller-reassigned", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    let controller = new AbortController(); controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/10-record-controller-reassigned.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-controller-method-write", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    controller.abort = () => {};
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/11-record-controller-method-write.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-controller-escape", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    Reflect.set(controller, "abort", () => {});
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/12-record-controller-escape.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-collection-replacement", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    requests.current = new Map();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/13-record-collection-replacement.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-updater-not-previous", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set<string>().add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/14-record-updater-not-previous.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-ambient-eval", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
declare const eval: (source: string) => unknown;
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/15-record-ambient-eval.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("literal-reset-with-independent-event", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useEffect, useState } from "react";
interface PanelProps { category: string; }
export const SelectionPanel = ({ category }: PanelProps) => {
 const [selection, setSelection] = useState(0);
 useEffect(() => { setSelection(0); }, [category]);
 return <button onClick={() => setSelection(selection + 1)}>{selection}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/32-literal-reset-with-independent-event.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("a-guarded-removal-helper-and-destructured-cancel", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename:
          "/synthetic/request-ownership-review/33-a-guarded-removal-helper-and-destructured-cancel.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("a-additional-unmatched-state-addition", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    setBusy(previous => new Set(previous).add("unrelated-view-state"));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename:
          "/synthetic/request-ownership-review/35-a-additional-unmatched-state-addition.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("readonly-controller-alias-chain", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const nativeController = new AbortController();
    const controller = nativeController;
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/readonly-controller-alias-chain.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("renamed-canonical-hook-imports", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback as memoCallback, useEffect as effect, useRef as ref, useState as state } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = ref<Map<string, RequestEntry>>(new Map());
  const counter = ref(0);
  const [busy, setBusy] = state<Set<string>>(new Set());
  const stopAll = memoCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  effect(() => { stopAll(); }, [category, stopAll]);
  effect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/renamed-canonical-hook-imports.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("controller-object-escapes", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    observe(controller);
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
const observe = (_value: unknown) => {};
`,
      {
        filename: "/synthetic/controller-record/controller-object-escapes.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("registry-ref-escapes", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
const observe = (_value: unknown) => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  observe(requests);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/registry-ref-escapes.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("map-current-alias-escapes", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
const observe = (_value: unknown) => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const transport = requests.current;
  observe(transport);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/map-current-alias-escapes.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("counter-reset", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    counter.current = 0;
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/counter-reset.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("constant-attempt-token", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = 1;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/constant-attempt-token.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("suspended-insertion-to-mark", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    await requestResource(controller.signal);
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/suspended-insertion-to-mark.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unknown-call-insertion-to-mark", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
const observe = () => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    observe();
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/unknown-call-insertion-to-mark.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("second-unmatched-registry-insertion", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    requests.current.set("other", { controller, attempt });
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/second-unmatched-registry-insertion.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-extra-property", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt, label: category });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/record-extra-property.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("record-spread-provider", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { ...{ controller }, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/record-spread-provider.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("default-destructured-controller", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller = new AbortController() }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/default-destructured-controller.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("async-release-callback", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(async ({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/async-release-callback.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("returned-release-block", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => { return controller.abort(); });
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/returned-release-block.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("wrong-cancel-forwarded-attempt", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, 0);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/wrong-cancel-forwarded-attempt.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unguarded-removal-helper", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/unguarded-removal-helper.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("finally-unguarded-delete", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      requests.current.delete(resourceKey);
      setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/finally-unguarded-delete.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("escaped-removal-helper", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
const observe = (_value: unknown) => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  observe(clearBusy);
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/escaped-removal-helper.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("returned-record-escapes", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
const observe = (_value: unknown) => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    observe(active);
    requests.current.delete(resourceKey);
    setBusy(previous => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return <button onClick={() => { if (busy.has("entry")) cancel("entry"); else void start("entry"); }}>{busy.has("entry") ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/returned-record-escapes.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("secondary-react-provider-mutation", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import ReactProvider, { useCallback, useEffect, useRef, useState } from "react";
ReactProvider.useRef = (() => ({ current: new Map() })) as typeof ReactProvider.useRef;
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/secondary-react-provider-mutation.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("erased-runtime-registry-shadow", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const overwrite = () => { interface requests {} requests.current = new Map(); };
  overwrite();
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/erased-runtime-registry-shadow.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("runtime-enum-channel", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
enum Channel { Ready = 0 }
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/runtime-enum-channel.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("ambient-runtime-provider", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
declare const hiddenController: AbortController;
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/ambient-runtime-provider.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("native-method-replacement", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
Map.prototype.clear = () => {};
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/native-method-replacement.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("selected-key-reassignment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    resourceKey = category;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/selected-key-reassignment.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("readonly-signal-transport", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      const response = await requestResource(controller.signal);
      void response;
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/readonly-signal-transport.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("separate-token-controller-maps-record-reset", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const tokens = useRef<Map<string, number>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const markBusy = (resourceKey: string, token: number) => {
    tokens.current.set(resourceKey, token);
    setBusy(previous => ({ ...previous, [resourceKey]: token }));
  };
  const clearBusy = (resourceKey: string) => {
    tokens.current.delete(resourceKey);
    controllers.current.delete(resourceKey);
    setBusy(previous => { const next = { ...previous }; delete next[resourceKey]; return next; });
  };
  const isStale = (resourceKey: string, token: number) => tokens.current.get(resourceKey) !== token;
  const stopAll = () => {
    tokens.current.clear();
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    setBusy({});
  };
  useEffect(() => { stopAll(); }, [category]);
  useEffect(() => () => { tokens.current.clear(); controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);
  const start = async (resourceKey: string) => {
    if (tokens.current.has(resourceKey)) return;
    const token = ++counter.current;
    const controller = new AbortController();
    controllers.current.set(resourceKey, controller);
    markBusy(resourceKey, token);
    try {
      await requestResource(controller.signal);
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    } catch {
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.entry !== undefined ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/request-ownership/16-separate-token-controller-maps.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("separate-token-map-membership-removal-and-immediate-cancel", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const tokens = useRef<Map<string, number>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const markBusy = (resourceKey: string, token: number) => {
    tokens.current.set(resourceKey, token);
    setBusy(previous => ({ ...previous, [resourceKey]: token }));
  };
  const clearBusy = (resourceKey: string) => {
    tokens.current.delete(resourceKey);
    controllers.current.delete(resourceKey);
    setBusy(previous => { if (!(resourceKey in previous)) return previous; const next = { ...previous }; delete next[resourceKey]; return next; });
  };
  const cancel = (resourceKey: string) => {
    if (!tokens.current.has(resourceKey)) return;
    controllers.current.get(resourceKey)?.abort();
    clearBusy(resourceKey);
  };
  const isStale = (resourceKey: string, token: number) => tokens.current.get(resourceKey) !== token;
  const stopAll = () => {
    tokens.current.clear();
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    setBusy({});
  };
  useEffect(() => { stopAll(); }, [category]);
  useEffect(() => () => { tokens.current.clear(); controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);
  const start = async (resourceKey: string) => {
    if (tokens.current.has(resourceKey)) return;
    const token = ++counter.current;
    const controller = new AbortController();
    controllers.current.set(resourceKey, controller);
    markBusy(resourceKey, token);
    try {
      await requestResource(controller.signal);
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    } catch {
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    }
  };
  return <button onClick={() => { if (busy.entry !== undefined) cancel("entry"); else void start("entry"); }}>{busy.entry !== undefined ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename:
          "/synthetic/request-ownership-review/34-b-membership-removal-helper-and-immediate-cancel.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("separate-policy-b-suspension-between-controller-insertion-and-mark", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const tokens = useRef<Map<string, number>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const markBusy = (resourceKey: string, token: number) => {
    tokens.current.set(resourceKey, token);
    setBusy(previous => ({ ...previous, [resourceKey]: token }));
  };
  const clearBusy = (resourceKey: string) => {
    tokens.current.delete(resourceKey);
    controllers.current.delete(resourceKey);
    setBusy(previous => { if (!(resourceKey in previous)) return previous; const next = { ...previous }; delete next[resourceKey]; return next; });
  };
  const cancel = (resourceKey: string) => {
    if (!tokens.current.has(resourceKey)) return;
    controllers.current.get(resourceKey)?.abort();
    clearBusy(resourceKey);
  };
  const isStale = (resourceKey: string, token: number) => tokens.current.get(resourceKey) !== token;
  const stopAll = () => {
    tokens.current.clear();
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    setBusy({});
  };
  useEffect(() => { stopAll(); }, [category]);
  useEffect(() => () => { tokens.current.clear(); controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);
  const start = async (resourceKey: string) => {
    if (tokens.current.has(resourceKey)) return;
    const token = ++counter.current;
    const controller = new AbortController();
    controllers.current.set(resourceKey, controller);
    await requestResource(controller.signal);
    markBusy(resourceKey, token);
    try {
      await requestResource(controller.signal);
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    } catch {
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    }
  };
  return <button onClick={() => { if (busy.entry !== undefined) cancel("entry"); else void start("entry"); }}>{busy.entry !== undefined ? "Cancel" : "Start"}</button>;
};
`,
      {
        filename:
          "/synthetic/request-ownership-review/36-b-suspension-between-controller-insertion-and-mark.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("outer-owner-shared-request-registry", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category: outerCategory }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const ScopedPanel = ({ category }: PanelProps) => {
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
  };
  return <><ScopedPanel category={outerCategory} /><ScopedPanel category={outerCategory} /></>;
};
`,
      {
        filename: "/synthetic/controller-record/outer-owner-shared-request-registry.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("outer-owner-shared-attempt-counter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category: outerCategory }: PanelProps) => {
  const counter = useRef(0);
  const ScopedPanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
  };
  return <><ScopedPanel category={outerCategory} /><ScopedPanel category={outerCategory} /></>;
};
`,
      {
        filename: "/synthetic/controller-record/outer-owner-shared-attempt-counter.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("addition-updater-default-extra-parameter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const readExtra = () => { throw new Error("unexpected default evaluation"); };
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy((previous, extra = readExtra()) => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/addition-updater-default-extra-parameter.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("deletion-updater-default-extra-parameter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const readExtra = () => { throw new Error("unexpected default evaluation"); };
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy((previous, extra = readExtra()) => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/deletion-updater-default-extra-parameter.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("reset-helper-default-parameter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const readExtra = () => { throw new Error("unexpected default evaluation"); };
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback((extra = readExtra()) => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/reset-helper-default-parameter.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("stale-guard-only-before-await", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
      await requestResource(controller.signal);
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/stale-guard-only-before-await.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("request-start-default-extra-parameter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const readExtra = () => { throw new Error("unexpected default evaluation"); };
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string, extra = readExtra()) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/request-start-default-extra-parameter.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("loading-has-method-transport", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const other = { has: (_value: unknown) => false };
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{other.has(busy.has) ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/loading-has-method-transport.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("const-key-constructor-provider", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const propertyName = "constructor";
const build = (() => {})[propertyName];
build("void 0")();
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/const-key-constructor-provider.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unknown-key-callable-provider-alias", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const readPropertyName = (): string => "constructor";
const propertyName = readPropertyName();
const callable = (() => {})[propertyName];
const invoke = callable;
invoke("void 0")();
import { useCallback, useEffect, useRef, useState } from "react";
interface PanelProps { category: string; }
interface RequestEntry { controller: AbortController; attempt: number; }
const requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => { stopAll(); }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy(previous => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });
      }
    }
  };
  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;
};
`,
      {
        filename: "/synthetic/controller-record/unknown-key-callable-provider-alias.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
