import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Tracer from "effect/Tracer";
import { anonymizeText } from "./anonymize-text.js";

const scrubValue = (value: unknown): unknown =>
  typeof value === "string" ? anonymizeText(value) : value;

/**
 * Anonymizes the failure a span ended with.
 *
 * The OTLP tracer runs `Cause.prettyErrors` over the exit and exports each
 * result as `exception.type` / `exception.message` / `exception.stacktrace`.
 * Stack traces are full of absolute paths, so a failing scan would ship the
 * user's home directory even though every attribute and event is scrubbed —
 * this is the one route into the payload that doesn't go through
 * `span.attribute`.
 *
 * Interrupt-only causes are left alone: the exporter emits a fixed
 * "Interrupted" label for them and never touches the error text.
 */
const scrubExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> => {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return exit;
  const errors = Cause.prettyErrors(exit.cause);
  if (errors.length === 0) return exit;
  const scrubbed = errors.map((error) => {
    const anonymized = new Error(anonymizeText(error.message));
    anonymized.name = anonymizeText(error.name);
    anonymized.stack = error.stack === undefined ? undefined : anonymizeText(error.stack);
    return Cause.fail(anonymized);
  });
  return Exit.failCause(scrubbed.reduce((left, right) => Cause.combine(left, right)));
};

const scrubAttributes = (
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!attributes) return attributes;
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    scrubbed[key] = scrubValue(value);
  }
  return scrubbed;
};

/**
 * Wraps a {@link Tracer.Span} so every value that reaches the exporter has been
 * run through {@link anonymizeText} first.
 *
 * Delegation is explicit rather than prototype-based: the wrapper forwards each
 * method to the real span, so the exporter keeps tracking the span it created
 * and no call depends on `this` binding surviving the indirection.
 */
const wrapSpan = (span: Tracer.Span): Tracer.Span => ({
  _tag: "Span",
  get name() {
    return span.name;
  },
  get spanId() {
    return span.spanId;
  },
  get traceId() {
    return span.traceId;
  },
  get parent() {
    return span.parent;
  },
  get annotations() {
    return span.annotations;
  },
  get status() {
    return span.status;
  },
  get attributes() {
    return span.attributes;
  },
  get links() {
    return span.links;
  },
  get sampled() {
    return span.sampled;
  },
  get kind() {
    return span.kind;
  },
  end: (endTime, exit) => {
    span.end(endTime, scrubExit(exit));
  },
  attribute: (key, value) => {
    span.attribute(key, scrubValue(value));
  },
  event: (name, startTime, attributes) => {
    span.event(anonymizeText(name), startTime, scrubAttributes(attributes));
  },
  addLinks: (links) => {
    span.addLinks(links);
  },
});

/**
 * Wraps a tracer so span names, attributes, and event payloads are anonymized
 * on the way to the exporter.
 *
 * This is the OTLP replacement for Sentry's `beforeSendTransaction` hook. OTLP
 * exporters have no equivalent interception point, so without this the only
 * thing standing between a raw filesystem path and the wire would be every
 * individual call site remembering to scrub — which is exactly the guarantee
 * the Sentry scrubber existed to stop relying on. Call sites should still scrub
 * at the source; this is the backstop for the ones that don't, including any
 * added later.
 */
export const makeScrubbingTracer = (underlying: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span: (options) => wrapSpan(underlying.span({ ...options, name: anonymizeText(options.name) })),
    ...(underlying.context ? { context: underlying.context } : {}),
  });
