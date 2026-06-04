import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { makeSentryTracer } from "../src/cli/utils/sentry-tracer.js";
import type { StartInactiveSpan } from "../src/cli/utils/sentry-tracer.js";

interface SpanRecord {
  name: string;
  startTime: unknown;
  endTime: unknown;
  kind: number | undefined;
  parentSpanId: string | null;
  spanId: string;
  traceId: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; startTime: unknown }>;
  statusCode: number | undefined;
  ended: boolean;
}

// Minimal stand-in for a Sentry span: records the lifecycle calls the bridge
// makes and structurally satisfies the SDK's `Span` interface (so no casts).
const buildFakeSpan = (record: SpanRecord) => {
  const span = {
    spanContext: () => ({ traceId: record.traceId, spanId: record.spanId, traceFlags: 1 }),
    setAttribute(key: string, value: string | number | boolean | undefined) {
      record.attributes[key] = value;
      return span;
    },
    setAttributes(attributes: Record<string, string | number | boolean | undefined>) {
      Object.assign(record.attributes, attributes);
      return span;
    },
    setStatus(status: { code: number; message?: string }) {
      record.statusCode = status.code;
      return span;
    },
    updateName(name: string) {
      record.name = name;
      return span;
    },
    isRecording() {
      return !record.ended;
    },
    addEvent(name: string, attributesOrStartTime?: unknown, startTime?: unknown) {
      record.events.push({ name, startTime: startTime ?? attributesOrStartTime });
      return span;
    },
    addLink() {
      return span;
    },
    addLinks() {
      return span;
    },
    end(endTime?: unknown) {
      record.ended = true;
      record.endTime = endTime;
    },
    recordException() {},
  };
  return span;
};

const buildHarness = () => {
  const created: SpanRecord[] = [];
  let counter = 0;

  const rootRecord: SpanRecord = {
    name: "root",
    startTime: undefined,
    endTime: undefined,
    kind: undefined,
    parentSpanId: null,
    spanId: "root",
    traceId: "trace",
    attributes: {},
    events: [],
    statusCode: undefined,
    ended: false,
  };
  const rootSpan = buildFakeSpan(rootRecord);

  const startInactiveSpan: StartInactiveSpan = (options) => {
    const parentSpanId =
      options.parentSpan === null || options.parentSpan === undefined
        ? null
        : options.parentSpan.spanContext().spanId;
    const record: SpanRecord = {
      name: options.name,
      startTime: options.startTime,
      endTime: undefined,
      kind: options.kind,
      parentSpanId,
      spanId: `span-${counter++}`,
      traceId: "trace",
      attributes: {},
      events: [],
      statusCode: undefined,
      ended: false,
    };
    created.push(record);
    return buildFakeSpan(record);
  };

  return { created, rootSpan, startInactiveSpan };
};

describe("makeSentryTracer", () => {
  it("nests Effect spans into Sentry: top-level under the root, children under their parent", async () => {
    const { created, rootSpan, startInactiveSpan } = buildHarness();
    const tracer = makeSentryTracer(rootSpan, startInactiveSpan);

    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("child"),
        Effect.withSpan("parent"),
        Effect.withTracer(tracer),
      ),
    );

    expect(created).toHaveLength(2);
    const parent = created.find((record) => record.name === "parent");
    const child = created.find((record) => record.name === "child");
    expect(parent?.parentSpanId).toBe("root");
    expect(child?.parentSpanId).toBe(parent?.spanId);
  });

  it("forwards attributes and ends spans with an OK status on success", async () => {
    const { created, rootSpan, startInactiveSpan } = buildHarness();
    const tracer = makeSentryTracer(rootSpan, startInactiveSpan);

    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("work", { attributes: { "inspect.directory": "/x", "inspect.count": 3 } }),
        Effect.withTracer(tracer),
      ),
    );

    const [record] = created;
    expect(record?.attributes).toMatchObject({ "inspect.directory": "/x", "inspect.count": 3 });
    expect(record?.statusCode).toBe(1);
    expect(record?.ended).toBe(true);
  });

  it("converts the epoch-nanosecond clock to a Sentry HrTime tuple", async () => {
    const { created, rootSpan, startInactiveSpan } = buildHarness();
    const tracer = makeSentryTracer(rootSpan, startInactiveSpan);
    const beforeSeconds = Math.floor(Date.now() / 1000);

    await Effect.runPromise(
      Effect.succeed("ok").pipe(Effect.withSpan("timed"), Effect.withTracer(tracer)),
    );

    const [record] = created;
    expect(Array.isArray(record?.startTime)).toBe(true);
    const startTime = record?.startTime as [number, number];
    expect(startTime[0]).toBeGreaterThanOrEqual(beforeSeconds);
    expect(startTime[1]).toBeGreaterThanOrEqual(0);
    expect(startTime[1]).toBeLessThan(1_000_000_000);
    expect(Array.isArray(record?.endTime)).toBe(true);
  });

  it("ends spans with an ERROR status when the effect fails", async () => {
    const { created, rootSpan, startInactiveSpan } = buildHarness();
    const tracer = makeSentryTracer(rootSpan, startInactiveSpan);

    await Effect.runPromiseExit(
      Effect.fail("boom").pipe(Effect.withSpan("failing"), Effect.withTracer(tracer)),
    );

    const [record] = created;
    expect(record?.statusCode).toBe(2);
    expect(record?.ended).toBe(true);
  });
});
