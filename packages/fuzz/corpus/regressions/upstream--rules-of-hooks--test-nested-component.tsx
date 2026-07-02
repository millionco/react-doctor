// rule: useHookAtTopLevel
// weakness: test-gating
// source: biomejs/biome#1473 (hooks in components/callbacks defined inside test blocks)
import { useState } from "react";

declare const test: (name: string, run: () => void) => void;
declare const expect: (value: unknown) => { toBeDefined: () => void };
declare const render: (element: unknown) => void;
declare const renderHook: <T>(run: () => T) => { result: { current: T } };
declare const useHook: () => number;

test("a", () => {
  const TestComponent = () => {
    useState();
    useHook();
    return null;
  };

  render(<TestComponent />);
});

test("b", () => {
  const { result } = renderHook(() => useHook());

  expect(result.current).toBeDefined();
});
