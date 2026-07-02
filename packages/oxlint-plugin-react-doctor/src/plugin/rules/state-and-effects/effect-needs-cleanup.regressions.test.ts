import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup regressions (PR #988 CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES)", () => {
  it("flags an implicit return of a react-hook-form `.watch()` handle (non-callable { unsubscribe })", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WatchForm = ({ form }) => {
  useEffect(() => form.watch((value) => {
    console.log(value);
  }), [form]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("watch");
  });

  it("flags returning a captured `.watch()` subscription object as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WatchForm = ({ form }) => {
  useEffect(() => {
    const subscription = form.watch((value) => {
      console.log(value);
    });
    return subscription;
  }, [form]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags directly returning an `fs.watch()` FSWatcher (cleanup is .close(), not the handle)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
import fs from "node:fs";
export const FileWatcher = ({ path }) => {
  useEffect(() => {
    return fs.watch(path, (eventType) => {
      console.log(eventType);
    });
  }, [path]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a `server.listen()` call with no cleanup return", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DevServer = ({ server }) => {
  useEffect(() => {
    server.listen(3000);
  }, [server]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("listen");
  });

  it("does not flag a `.listen()` subscription whose returned disposer is returned as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const StoreListener = ({ store }) => {
  useEffect(() => {
    const stop = store.listen((value) => {
      console.log(value);
    });
    return stop;
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `.subscribe()` subscription whose returned disposer is returned as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const StoreSubscriber = ({ store }) => {
  useEffect(() => {
    const unsubscribe = store.subscribe((value) => {
      console.log(value);
    });
    return unsubscribe;
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an HTTP `server.listen(port)` whose returned server is returned from the effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DevServer = ({ app }) => {
  useEffect(() => {
    const server = app.listen(3000);
    return server;
  }, [app]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
