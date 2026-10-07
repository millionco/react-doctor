import { createRequire } from "node:module";
import type * as React from "react";
import { describe, expect, it } from "vite-plus/test";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "../../src/cli/ink/react-runtime.js";

describe("Ink React runtime", () => {
  it("uses the same React instance as the Ink renderer", () => {
    const requireFromInk = createRequire(createRequire(import.meta.url).resolve("ink"));
    const inkReact: typeof React = requireFromInk("react");

    expect(useEffect).toBe(inkReact.useEffect);
    expect(useMemo).toBe(inkReact.useMemo);
    expect(useRef).toBe(inkReact.useRef);
    expect(useState).toBe(inkReact.useState);
    expect(useSyncExternalStore).toBe(inkReact.useSyncExternalStore);
  });
});
