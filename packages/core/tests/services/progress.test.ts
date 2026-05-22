import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vite-plus/test";
import type { ProgressHandle } from "../../src/services/progress.js";
import { Progress, ProgressCapture } from "../../src/services/progress.js";

describe("Progress.layerNoop", () => {
  it("start returns handles whose succeed / fail are no-ops", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const progress = yield* Progress;
        const handle = yield* progress.start("hello");
        yield* handle.succeed("done");
        yield* handle.fail("fail too — both safe");
        return "ok";
      }).pipe(Effect.provide(Progress.layerNoop)),
    );
    expect(result).toBe("ok");
  });
});

describe("Progress.layerOra", () => {
  it("calls the injected factory exactly once per start", async () => {
    const calls: string[] = [];
    const factory = (text: string): ProgressHandle => {
      calls.push(`start:${text}`);
      return {
        succeed: (displayText: string) => Effect.sync(() => calls.push(`succeed:${displayText}`)),
        fail: (displayText: string) => Effect.sync(() => calls.push(`fail:${displayText}`)),
      };
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const progress = yield* Progress;
        const a = yield* progress.start("Running checks");
        yield* a.succeed("Checks done");
        const b = yield* progress.start("Other phase");
        yield* b.fail("Other phase failed");
      }).pipe(Effect.provide(Progress.layerOra(factory))),
    );
    expect(calls).toEqual([
      "start:Running checks",
      "succeed:Checks done",
      "start:Other phase",
      "fail:Other phase failed",
    ]);
  });
});

describe("Progress.layerCapture", () => {
  it("records start / succeed / fail events into ProgressCapture Ref", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const progress = yield* Progress;
        const handle = yield* progress.start("Phase A");
        yield* handle.succeed("Phase A done");
        const failed = yield* progress.start("Phase B");
        yield* failed.fail("Phase B exploded");
        const ref = yield* ProgressCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Progress.layerCapture)),
    );
    expect(events).toEqual([
      { _tag: "Started", text: "Phase A" },
      { _tag: "Succeeded", text: "Phase A done" },
      { _tag: "Started", text: "Phase B" },
      { _tag: "Failed", text: "Phase B exploded" },
    ]);
  });
});
