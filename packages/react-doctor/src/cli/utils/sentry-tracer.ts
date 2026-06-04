import * as Sentry from "@sentry/node";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import {
  NANOSECONDS_PER_SECOND,
  SENTRY_SPAN_STATUS_ERROR,
  SENTRY_SPAN_STATUS_OK,
  TRACE_FLAG_SAMPLED,
} from "./constants.js";

type SentrySpan = ReturnType<typeof Sentry.startInactiveSpan>;

// The Sentry span factory the bridge depends on. Defaults to the live SDK;
// tests inject a fake so the lifecycle mapping can be verified without a real
// Sentry client/transport.
export type StartInactiveSpan = typeof Sentry.startInactiveSpan;

// An Effect span that also carries the Sentry span it drives, so child spans
// can resolve their concrete Sentry parent (Effect hands us the parent as an
// opaque `AnySpan`). An intersection (rather than `interface extends`) so the
// imported `Tracer.Span` type stays namespace-qualified.
type SentryBackedSpan = Tracer.Span & {
  readonly sentrySpan: SentrySpan;
};

// Effect span clocks are epoch nanoseconds (bigint); Sentry/OTel want an
// `[seconds, nanosRemainder]` HrTime tuple. Splitting the bigint (rather than
// dividing to a float) preserves sub-millisecond precision on long scans.
const toHrTime = (epochNanoseconds: bigint): [number, number] => [
  Number(epochNanoseconds / NANOSECONDS_PER_SECOND),
  Number(epochNanoseconds % NANOSECONDS_PER_SECOND),
];

const SPAN_KIND_TO_OTEL: Record<Tracer.SpanKind, 0 | 1 | 2 | 3 | 4> = {
  internal: 0,
  server: 1,
  client: 2,
  producer: 3,
  consumer: 4,
};

// Sentry attribute values must be primitives (or primitive arrays). Effect
// permits arbitrary values, so coerce anything non-primitive to a stable string
// instead of dropping the attribute.
const toSentryAttributeValue = (value: unknown): string | number | boolean | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
};

const normalizeAttributes = (
  attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | undefined> => {
  const normalized: Record<string, string | number | boolean | undefined> = {};
  if (!attributes) return normalized;
  for (const [key, value] of Object.entries(attributes)) {
    normalized[key] = toSentryAttributeValue(value);
  }
  return normalized;
};

const isSentryBackedSpan = (span: Tracer.AnySpan): span is SentryBackedSpan =>
  span._tag === "Span" && "sentrySpan" in span;

const spanContextFor = (
  span: Tracer.AnySpan,
): { traceId: string; spanId: string; traceFlags: number } =>
  isSentryBackedSpan(span)
    ? span.sentrySpan.spanContext()
    : {
        traceId: span.traceId,
        spanId: span.spanId,
        traceFlags: span.sampled ? TRACE_FLAG_SAMPLED : 0,
      };

/**
 * Builds an Effect {@link Tracer.Tracer} that materializes every Effect span
 * (`Effect.withSpan(...)` / `Effect.fn("Service.method")`) as a child Sentry
 * span, producing one unified per-run trace in Sentry. The CLI already
 * instruments `runInspect` and each core service method, so this bridge lights
 * all of that up in Sentry for free.
 *
 * `rootSpan` is the active per-run transaction; Effect spans without an Effect
 * parent attach to it, so nesting is correct even if async-context propagation
 * is interrupted by Effect's fiber scheduler. Provided to a program via
 * `Effect.withTracer(...)`.
 */
export const makeSentryTracer = (
  rootSpan: SentrySpan,
  startInactiveSpan: StartInactiveSpan = Sentry.startInactiveSpan,
): Tracer.Tracer =>
  Tracer.make({
    span: (options) => {
      const parentSpan =
        Option.isSome(options.parent) && isSentryBackedSpan(options.parent.value)
          ? options.parent.value.sentrySpan
          : rootSpan;

      const sentrySpan = startInactiveSpan({
        name: options.name,
        startTime: toHrTime(options.startTime),
        parentSpan,
        kind: SPAN_KIND_TO_OTEL[options.kind],
      });

      const { traceId, spanId } = sentrySpan.spanContext();
      const attributes = new Map<string, unknown>();
      let status: Tracer.SpanStatus = { _tag: "Started", startTime: options.startTime };

      const span: SentryBackedSpan = {
        _tag: "Span",
        sentrySpan,
        name: options.name,
        spanId,
        traceId,
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
          sentrySpan.setStatus({
            code: Exit.isSuccess(exit) ? SENTRY_SPAN_STATUS_OK : SENTRY_SPAN_STATUS_ERROR,
          });
          sentrySpan.end(toHrTime(endTime));
        },
        attribute: (key, value) => {
          attributes.set(key, value);
          sentrySpan.setAttribute(key, toSentryAttributeValue(value));
        },
        event: (name, startTime, eventAttributes) => {
          sentrySpan.addEvent(name, normalizeAttributes(eventAttributes), toHrTime(startTime));
        },
        addLinks: (links) => {
          for (const link of links) {
            sentrySpan.addLink({
              context: spanContextFor(link.span),
              attributes: normalizeAttributes(link.attributes),
            });
          }
        },
      };

      return span;
    },
  });
