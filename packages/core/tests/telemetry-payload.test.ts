import * as http from "node:http";
import * as os from "node:os";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { AXIOM_DATASET_HEADER, AXIOM_METRICS_DATASET_HEADER } from "../src/constants.js";
import { layerAxiomMetrics, layerAxiomTraces } from "../src/observability.js";

interface CapturedRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let server: http.Server;
let captured: CapturedRequest[];
let baseUrl: string;

beforeEach(async () => {
  captured = [];
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      captured.push({
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const telemetryOptions = () => ({
  token: Redacted.make("test-token"),
  domain: baseUrl,
  tracesDataset: "traces-dataset",
  metricsDataset: "metrics-dataset",
  serviceVersion: "1.2.3",
});

const runWithTelemetry = <A>(program: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(layerAxiomTraces(telemetryOptions()))));

const exportMetrics = (): Promise<void> =>
  Effect.runPromise(Effect.provide(Effect.void, layerAxiomMetrics(telemetryOptions())));

const bodyText = (): string => captured.map((request) => request.body.toString("utf8")).join("\n");

const countPayloadsContaining = (path: string, needle: string): number =>
  captured.filter(
    (request) => request.path === path && request.body.toString("utf8").includes(needle),
  ).length;

describe("Axiom telemetry payloads", () => {
  it("sends spans to the traces dataset with bearer auth and protobuf", async () => {
    await runWithTelemetry(Effect.withSpan("probe")(Effect.void));

    const traces = captured.find((request) => request.path === "/v1/traces");
    expect(traces).toBeDefined();
    expect(traces?.headers[AXIOM_DATASET_HEADER.toLowerCase()]).toBe("traces-dataset");
    expect(traces?.headers.authorization).toBe("Bearer test-token");
    expect(traces?.headers["content-type"]).toBe("application/x-protobuf");
  });

  it("sends metrics to the metrics dataset, which uses a different header", async () => {
    await exportMetrics();

    const metrics = captured.find((request) => request.path === "/v1/metrics");
    expect(metrics).toBeDefined();
    expect(metrics?.headers[AXIOM_METRICS_DATASET_HEADER]).toBe("metrics-dataset");
    expect(metrics?.headers.authorization).toBe("Bearer test-token");
    expect(metrics?.headers["content-type"]).toBe("application/x-protobuf");
  });

  it("does not export metrics from the traces layer", async () => {
    Metric.counter("traces.layer.probe").updateUnsafe(1, Context.empty());
    await runWithTelemetry(Effect.withSpan("probe")(Effect.void));

    // Metrics live in a process-global registry, so a traces layer that also
    // carried a metrics exporter would ship them here — and then again at the
    // exit flush, double-counting every counter.
    expect(captured.some((request) => request.path === "/v1/metrics")).toBe(false);
  });

  it("scrubs the home directory out of span attributes before they reach the wire", async () => {
    const homeDirectory = os.homedir();
    await runWithTelemetry(
      Effect.withSpan("scan", {
        attributes: { "inspect.directory": `${homeDirectory}/projects/secret-app` },
      })(Effect.void),
    );

    const payload = bodyText();
    expect(payload).not.toContain(homeDirectory);
    expect(payload).toContain("~/projects/secret-app");
  });

  it("scrubs the home directory out of span names", async () => {
    const homeDirectory = os.homedir();
    await runWithTelemetry(Effect.withSpan(`scan ${homeDirectory}/app`)(Effect.void));

    expect(bodyText()).not.toContain(homeDirectory);
  });

  it("scrubs the home directory out of the failure a span ended with", async () => {
    const homeDirectory = os.homedir();
    await Effect.runPromise(
      Effect.fail(new Error(`ENOENT: ${homeDirectory}/projects/secret-app/doctor.config.ts`)).pipe(
        Effect.withSpan("scan"),
        Effect.provide(layerAxiomTraces(telemetryOptions())),
        Effect.exit,
      ),
    );

    // The OTLP tracer turns the exit into `exception.message` /
    // `exception.stacktrace` attributes, which never pass through
    // `span.attribute` — so this is a separate leak route from the ones above.
    const payload = bodyText();
    expect(payload).toContain("exception");
    expect(payload).not.toContain(homeDirectory);
  });

  it("masks secrets echoed into span attributes", async () => {
    await runWithTelemetry(
      Effect.withSpan("scan", {
        attributes: { "config.value": "token ghp_0123456789abcdefghijklmnopqrstuvwxyzA" },
      })(Effect.void),
    );

    expect(bodyText()).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyzA");
  });

  it("carries the service version as a resource attribute", async () => {
    await runWithTelemetry(Effect.withSpan("probe")(Effect.void));

    expect(bodyText()).toContain("1.2.3");
  });

  it("re-reports a counter in full when a second metrics exporter is built", async () => {
    // Guards the reason metrics are exported exactly once per process. Effect
    // keeps delta-temporality state on the exporter instance, so a second
    // exporter has no previous snapshot and reports the counter's whole value
    // again. `flushTelemetry` is memoized so this cannot happen in the CLI; this
    // test pins the underlying behavior so a refactor that merges the traces and
    // metrics layers fails loudly instead of silently doubling every metric.
    Metric.counter("double.count.probe").updateUnsafe(7, Context.empty());

    await exportMetrics();
    await exportMetrics();

    expect(countPayloadsContaining("/v1/metrics", "double.count.probe")).toBe(2);
  });
});
