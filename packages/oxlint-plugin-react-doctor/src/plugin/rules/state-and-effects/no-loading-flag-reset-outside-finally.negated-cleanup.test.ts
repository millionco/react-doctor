import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const makeSource = ({
  beforeRequest = "",
  beforeTry = "",
  launch = "load();",
  cleanup = "return () => { cancelled = true; };",
  deps = "[]",
  prefix = "",
} = {}): string =>
  [
    "import { useEffect, useState } from 'react';",
    prefix,
    "export function Screen({ run, enabled, onSetter, access }) {",
    "  const [loading, setLoading] = useState(false);",
    "  useEffect(() => {",
    "    let cancelled = false;",
    beforeRequest,
    "    const load = async () => {",
    "      setLoading(true);",
    beforeTry,
    "      try { await run(); } finally {",
    "        if (!cancelled) setLoading(false);",
    "      }",
    "    };",
    launch,
    cleanup,
    "  }, " + deps + ");",
    "  return <div>{String(loading)}</div>;",
    "}",
  ].join("\n");

const scan = (source: string) =>
  runRule(noLoadingFlagResetOutsideFinally, source, { filename: "Screen.tsx" }).diagnostics;

describe("no-loading-flag-reset-outside-finally with a negated cleanup guard", () => {
  it("allows one unconditional mount request with a private loading setter", () => {
    expect(scan(makeSource())).toHaveLength(0);
  });

  it("warns when another request can start in the same effect", () => {
    expect(scan(makeSource({ launch: "load(); load();" }))).toHaveLength(1);
  });

  it("warns when the loading setter escapes", () => {
    expect(scan(makeSource({ beforeRequest: "onSetter(setLoading);" }))).toHaveLength(1);
  });

  it("warns when the request can reject before the protecting try", () => {
    expect(scan(makeSource({ beforeTry: "await run();" }))).toHaveLength(1);
  });

  it("warns when an open replacement can skip its request", () => {
    expect(
      scan(makeSource({ beforeRequest: "if (!enabled) return;", deps: "[enabled]" })),
    ).toHaveLength(1);
  });

  it("warns when an accessor can throw before cleanup retires the request", () => {
    expect(
      scan(
        makeSource({
          cleanup: "return () => { access.value; cancelled = true; };",
        }),
      ),
    ).toHaveLength(1);
  });

  it.each(["({ cancelled } = { cancelled: true });", "for (cancelled of [true]) {}"])(
    "warns when the request guard is changed by %s",
    (write) => {
      expect(scan(makeSource({ beforeTry: write }))).toHaveLength(1);
    },
  );

  it("warns when a CommonJS React export can run cleanup before unmount", () => {
    expect(
      scan(
        makeSource({
          prefix: [
            "const React = require('react');",
            "const originalEffect = React.useEffect;",
            "Object.defineProperty(React, 'useEffect', {",
            "  value: (setup, deps) => originalEffect(() => { setup()(); }, deps),",
            "});",
          ].join("\n"),
        }),
      ),
    ).toHaveLength(1);
  });
});
