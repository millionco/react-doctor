import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { codeGradingBatchSchema } from "./code-grading-schema.js";
import type { CodeGradingOptions } from "./code-grading-schema.js";
import {
  CODE_GRADING_ADDRESS_REQUESTS_PER_WINDOW,
  CODE_GRADING_BODY_TIMEOUT_MS,
  CODE_GRADING_HEADERS_TIMEOUT_MS,
  CODE_GRADING_ITEMS_PER_WINDOW,
  CODE_GRADING_MAX_ACTIVE_BATCHES,
  CODE_GRADING_MAX_CONNECTIONS,
  CODE_GRADING_MAX_HEADER_BYTES,
  CODE_GRADING_MAX_RATE_ADDRESSES,
  CODE_GRADING_MAX_REQUEST_BYTES,
  CODE_GRADING_MS_PER_SECOND,
  CODE_GRADING_RATE_WINDOW_MS,
  CODE_GRADING_REQUESTS_PER_WINDOW,
  CODE_GRADING_REQUEST_TIMEOUT_MS,
} from "./constants.js";
import { createCodeGradingRuntime } from "./create-code-grading-runtime.js";
import { gradeCodeBatch } from "./grade-code-batch.js";
import { createTokenBucket } from "./utils/create-token-bucket.js";
import type { TokenBucket } from "./utils/create-token-bucket.js";

export interface CodeGradingServerOptions extends Pick<CodeGradingOptions, "evaluator" | "cache"> {
  apiKey: string;
  checkAdmission?: () => Promise<CodeGradingAdmission>;
  rateLimit?: {
    requests?: number;
    items?: number;
    addressRequests?: number;
    windowMs?: number;
  };
  bodyTimeoutMs?: number;
  now?: () => number;
}

export interface CodeGradingAdmission {
  status: "allowed" | "limited" | "unavailable";
}

interface AddressRateLimit {
  bucket: TokenBucket;
  lastSeenAt: number;
}

export const createCodeGradingServer = (options: CodeGradingServerOptions): Server => {
  if (!options.apiKey.trim()) throw new TypeError("A grading API key is required");
  const bodyTimeoutMs = options.bodyTimeoutMs ?? CODE_GRADING_BODY_TIMEOUT_MS;
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1)
    throw new TypeError("Body timeout must be positive");
  const expectedAuthorization = createHash("sha256").update(`Bearer ${options.apiKey}`).digest();
  const runtime = createCodeGradingRuntime(options);
  const bucketOptions = {
    windowMs: options.rateLimit?.windowMs ?? CODE_GRADING_RATE_WINDOW_MS,
    now: options.now,
  };
  const requestBucket = createTokenBucket({
    ...bucketOptions,
    capacity: options.rateLimit?.requests ?? CODE_GRADING_REQUESTS_PER_WINDOW,
  });
  const itemBucket = createTokenBucket({
    ...bucketOptions,
    capacity: options.rateLimit?.items ?? CODE_GRADING_ITEMS_PER_WINDOW,
  });
  const addressCapacity =
    options.rateLimit?.addressRequests ?? CODE_GRADING_ADDRESS_REQUESTS_PER_WINDOW;
  createTokenBucket({ ...bucketOptions, capacity: addressCapacity });
  const addressBuckets = new Map<string, AddressRateLimit>();
  const now = options.now ?? (() => performance.now());
  let activeBatches = 0;
  const server = createServer(
    {
      requestTimeout: CODE_GRADING_REQUEST_TIMEOUT_MS,
      headersTimeout: CODE_GRADING_HEADERS_TIMEOUT_MS,
      maxHeaderSize: CODE_GRADING_MAX_HEADER_BYTES,
    },
    async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const reject = (status: number, error: string, retryMs?: number) => {
        if (response.destroyed || response.headersSent) return;
        response.setHeader("Connection", "close");
        if (retryMs !== undefined)
          response.setHeader(
            "Retry-After",
            String(Math.max(1, Math.ceil(retryMs / CODE_GRADING_MS_PER_SECOND))),
          );
        response.writeHead(status).end(JSON.stringify({ error }));
      };
      const address = request.socket.remoteAddress ?? "unknown";
      const currentTime = now();
      let addressEntry = addressBuckets.get(address);
      if (!addressEntry) {
        if (addressBuckets.size >= CODE_GRADING_MAX_RATE_ADDRESSES) {
          for (const [existingAddress, entry] of addressBuckets) {
            if (currentTime - entry.lastSeenAt >= bucketOptions.windowMs)
              addressBuckets.delete(existingAddress);
          }
        }
        if (addressBuckets.size >= CODE_GRADING_MAX_RATE_ADDRESSES) {
          reject(503, "Address limit reached; retry later", bucketOptions.windowMs);
          return;
        }
        addressEntry = {
          bucket: createTokenBucket({ ...bucketOptions, capacity: addressCapacity }),
          lastSeenAt: currentTime,
        };
        addressBuckets.set(address, addressEntry);
      }
      addressEntry.lastSeenAt = currentTime;
      const addressRetryMs = addressEntry.bucket.consume();
      if (addressRetryMs > 0) {
        reject(429, "Connection address rate limit exceeded", addressRetryMs);
        return;
      }
      const authorization = createHash("sha256")
        .update(request.headers.authorization ?? "")
        .digest();
      if (
        request.headersDistinct.authorization?.length !== 1 ||
        !timingSafeEqual(expectedAuthorization, authorization)
      ) {
        reject(401, "Unauthorized");
        return;
      }
      if (request.url !== "/v1/check") {
        reject(404, "Not found");
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        reject(405, "Use POST");
        return;
      }
      const requestRetryMs = requestBucket.consume();
      if (requestRetryMs > 0) {
        reject(429, "Request rate limit exceeded", requestRetryMs);
        return;
      }
      if (
        request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
          "application/json" ||
        (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")
      ) {
        reject(415, "Use uncompressed application/json");
        return;
      }
      if (Number(request.headers["content-length"]) > CODE_GRADING_MAX_REQUEST_BYTES) {
        reject(413, "Request body is too large");
        return;
      }
      if (activeBatches >= CODE_GRADING_MAX_ACTIVE_BATCHES) {
        reject(503, "Grader busy; retry later", CODE_GRADING_MS_PER_SECOND);
        return;
      }
      activeBatches += 1;
      const controller = new AbortController();
      const disconnect = () => {
        if (!response.writableEnded) controller.abort(new Error("Grading client disconnected"));
      };
      response.once("close", disconnect);
      const bodyTimer = setTimeout(() => {
        response.once("finish", () => request.destroy());
        reject(408, "Request body timed out");
      }, bodyTimeoutMs);
      try {
        if (options.checkAdmission) {
          const admission = await options.checkAdmission();
          if (admission.status !== "allowed") {
            reject(
              admission.status === "limited" ? 429 : 503,
              "Firewall admission denied; retry later",
              CODE_GRADING_RATE_WINDOW_MS,
            );
            return;
          }
          if (response.writableEnded || response.destroyed) return;
        }
        let receivedBytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > CODE_GRADING_MAX_REQUEST_BYTES) {
            reject(413, "Request body is too large");
            return;
          }
          chunks.push(buffer);
        }
        clearTimeout(bodyTimer);
        let input: unknown;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(400, "Invalid JSON");
          return;
        }
        const parsed = codeGradingBatchSchema.safeParse(input);
        if (!parsed.success) {
          reject(400, "Invalid grading batch");
          return;
        }
        const itemRetryMs = itemBucket.consume(parsed.data.items.length);
        if (itemRetryMs > 0) {
          reject(429, "Item rate limit exceeded; reduce batch size or retry later", itemRetryMs);
          return;
        }
        const result = await gradeCodeBatch(parsed.data, {
          runtime,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(CODE_GRADING_REQUEST_TIMEOUT_MS),
          ]),
        });
        if (!response.destroyed) response.end(JSON.stringify(result));
      } catch {
        reject(500, "Grading request failed");
      } finally {
        clearTimeout(bodyTimer);
        response.removeListener("close", disconnect);
        activeBatches -= 1;
      }
    },
  );
  server.maxConnections = CODE_GRADING_MAX_CONNECTIONS;
  return server;
};
