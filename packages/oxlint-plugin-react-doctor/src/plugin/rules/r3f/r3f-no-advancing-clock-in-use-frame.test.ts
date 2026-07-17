import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoAdvancingClockInUseFrame } from "./r3f-no-advancing-clock-in-use-frame.js";

describe("r3f-no-advancing-clock-in-use-frame", () => {
  it("flags state.clock and destructured clock methods", () => {
    const first = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => state.clock.getDelta());`,
    );
    const second = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ clock }) => clock.getElapsedTime());`,
    );
    expect(first.diagnostics).toHaveLength(1);
    expect(second.diagnostics).toHaveLength(1);
  });

  it("allows elapsedTime reads", () => {
    const result = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ clock }) => consume(clock.elapsedTime));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a stable local clock alias", () => {
    const result = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => { const clock = state.clock; clock.getDelta(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags clocks destructured from a local R3F state binding", () => {
    const result = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => { const { ["clock"]: frameClock = fallbackClock } = state; frameClock.getElapsedTime(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores shadowed clock and state parameters in synchronous callbacks", () => {
    const result = runRule(
      r3fNoAdvancingClockInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ clock }) => { [externalClock].forEach((clock) => clock.getDelta()); [externalState].forEach((state) => state.clock.getElapsedTime()); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
