import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vite-plus/test";
import {
  layerAxiomMetrics,
  layerAxiomTraces,
  layerObservability,
  layerUserOtlp,
} from "../src/observability.js";
import type { AxiomTelemetryOptions } from "../src/types/observability.js";

const axiomOptions: AxiomTelemetryOptions = {
  token: Redacted.make("test-token"),
  domain: "https://example.invalid",
  tracesDataset: "react-doctor",
  metricsDataset: "react-doctor-metrics",
  serviceVersion: "0.0.0-test",
};

const withoutOtlpEnv = async <A>(body: () => Promise<A>): Promise<A> => {
  const previous = {
    endpoint: process.env["REACT_DOCTOR_OTLP_ENDPOINT"],
    auth: process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"],
  };
  delete process.env["REACT_DOCTOR_OTLP_ENDPOINT"];
  delete process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"];
  try {
    return await body();
  } finally {
    if (previous.endpoint !== undefined) {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = previous.endpoint;
    }
    if (previous.auth !== undefined) {
      process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"] = previous.auth;
    }
  }
};

describe("layerUserOtlp", () => {
  it("is a no-op when REACT_DOCTOR_OTLP_ENDPOINT is missing", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerUserOtlp)));
      expect(result).toBe("ran");
    });
  });

  it("is a no-op when only the endpoint is set (auth header missing)", async () => {
    await withoutOtlpEnv(async () => {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = "https://example.invalid";
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerUserOtlp)));
      expect(result).toBe("ran");
    });
  });

  it("composes with other layers without leaking requirements", async () => {
    await withoutOtlpEnv(async () => {
      const baseLayer = Layer.empty;
      const composed = Layer.merge(baseLayer, layerUserOtlp);
      const result = await Effect.runPromise(Effect.succeed(42).pipe(Effect.provide(composed)));
      expect(result).toBe(42);
    });
  });

  it("builds with the fetch HTTP client when OTLP env is configured", async () => {
    await withoutOtlpEnv(async () => {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = "https://example.invalid";
      process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"] = "Bearer test";
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerUserOtlp)));
      expect(result).toBe("ran");
    });
  });
});

describe("layerAxiomTraces", () => {
  it("builds with serialization and the HTTP client already provided", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(layerAxiomTraces(axiomOptions))),
      );
      expect(result).toBe("ran");
    });
  });

  it("tolerates a domain with a trailing slash", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const layer = layerAxiomTraces({ ...axiomOptions, domain: "https://example.invalid/" });
      const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      expect(result).toBe("ran");
    });
  });
});

describe("layerAxiomMetrics", () => {
  it("builds with serialization and the HTTP client already provided", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(layerAxiomMetrics(axiomOptions))),
      );
      expect(result).toBe("ran");
    });
  });
});

describe("layerObservability", () => {
  it("is a no-op when no Axiom options are supplied and no OTLP env is set", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerObservability())));
      expect(result).toBe("ran");
    });
  });

  it("exports to Axiom when options are supplied", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(layerObservability(axiomOptions))),
      );
      expect(result).toBe("ran");
    });
  });

  it("prefers a user-configured OTLP endpoint over first-party Axiom", async () => {
    await withoutOtlpEnv(async () => {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = "https://example.invalid";
      process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"] = "Bearer test";
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(layerObservability(axiomOptions))),
      );
      expect(result).toBe("ran");
    });
  });

  it("composes with other layers without leaking requirements", async () => {
    await withoutOtlpEnv(async () => {
      const composed = Layer.merge(Layer.empty, layerObservability(axiomOptions));
      const result = await Effect.runPromise(Effect.succeed(42).pipe(Effect.provide(composed)));
      expect(result).toBe(42);
    });
  });
});
