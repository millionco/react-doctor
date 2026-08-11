import * as os from "node:os";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Tracer from "effect/Tracer";
import { describe, expect, it } from "vite-plus/test";
import { makeScrubbingTracer } from "../src/utils/make-scrubbing-tracer.js";

interface RecordedSpan {
  name: string;
  attributes: Map<string, unknown>;
  events: Array<{ name: string; attributes: Record<string, unknown> | undefined }>;
  ended: boolean;
  exit: Exit.Exit<unknown, unknown> | null;
}

const makeRecordingTracer = (): { tracer: Tracer.Tracer; spans: RecordedSpan[] } => {
  const spans: RecordedSpan[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      const attributes = new Map<string, unknown>();
      const record: RecordedSpan = {
        name: options.name,
        attributes,
        events: [],
        ended: false,
        exit: null,
      };
      spans.push(record);
      let status: Tracer.SpanStatus = { _tag: "Started", startTime: options.startTime };
      return {
        _tag: "Span",
        name: options.name,
        spanId: "span-id",
        traceId: "trace-id",
        parent: options.parent,
        annotations: options.annotations,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        get status() {
          return status;
        },
        get attributes() {
          return attributes;
        },
        end: (endTime, exit) => {
          status = { _tag: "Ended", startTime: options.startTime, endTime, exit };
          record.ended = true;
          record.exit = exit;
        },
        attribute: (key, value) => {
          attributes.set(key, value);
        },
        event: (name, _startTime, eventAttributes) => {
          record.events.push({ name, attributes: eventAttributes });
        },
        addLinks: () => {},
      };
    },
  });
  return { tracer, spans };
};

const runWithTracer = <A>(program: Effect.Effect<A>, tracer: Tracer.Tracer): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.withTracer(makeScrubbingTracer(tracer))));

describe("makeScrubbingTracer", () => {
  it("scrubs the home directory from string attributes", async () => {
    const { tracer, spans } = makeRecordingTracer();
    const homeDirectory = os.homedir();

    await runWithTracer(
      Effect.withSpan("scan", { attributes: { directory: `${homeDirectory}/app` } })(Effect.void),
      tracer,
    );

    expect(spans[0]?.attributes.get("directory")).toBe("~/app");
  });

  it("scrubs the span name", async () => {
    const { tracer, spans } = makeRecordingTracer();
    const homeDirectory = os.homedir();

    await runWithTracer(Effect.withSpan(`scan ${homeDirectory}`)(Effect.void), tracer);

    expect(spans[0]?.name).toBe("scan ~");
  });

  it("leaves non-string attribute values untouched", async () => {
    const { tracer, spans } = makeRecordingTracer();

    await runWithTracer(
      Effect.withSpan("scan", { attributes: { count: 42, enabled: true } })(Effect.void),
      tracer,
    );

    expect(spans[0]?.attributes.get("count")).toBe(42);
    expect(spans[0]?.attributes.get("enabled")).toBe(true);
  });

  it("still ends the underlying span so the exporter sees it", async () => {
    const { tracer, spans } = makeRecordingTracer();

    await runWithTracer(Effect.withSpan("scan")(Effect.void), tracer);

    expect(spans[0]?.ended).toBe(true);
    expect(Exit.isSuccess(spans[0]?.exit ?? Exit.fail("missing"))).toBe(true);
  });

  it("records the failure exit on the underlying span", async () => {
    const { tracer, spans } = makeRecordingTracer();

    await Effect.runPromiseExit(
      Effect.fail("boom").pipe(
        Effect.withSpan("scan"),
        Effect.withTracer(makeScrubbingTracer(tracer)),
      ),
    );

    expect(spans[0]?.ended).toBe(true);
    expect(Exit.isFailure(spans[0]?.exit ?? Exit.succeed("missing"))).toBe(true);
  });

  it("scrubs event names and event attributes", async () => {
    const { tracer, spans } = makeRecordingTracer();
    const homeDirectory = os.homedir();

    await runWithTracer(
      Effect.withSpan("scan")(
        Effect.annotateCurrentSpan("noop", true).pipe(
          Effect.andThen(
            Effect.currentSpan.pipe(
              Effect.map((span) => {
                span.event(`read ${homeDirectory}/f`, 0n, { path: `${homeDirectory}/f` });
              }),
            ),
          ),
        ),
      ),
      tracer,
    );

    const event = spans[0]?.events[0];
    expect(event?.name).toBe("read ~/f");
    expect(event?.attributes?.path).toBe("~/f");
  });
});
