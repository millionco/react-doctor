# Code grading with Jev

Submit code and a rule contract to Typesafe Jev. Optionally include the result from
React Doctor. Each item returns an assessment, confidence values, and a verdict.
One failed item does not stop the batch.

This is an internal API in the private eval package. It does not change the public
`react-doctor/api` package, the website, or the published GitHub Action.

## Input

Save this JSON as `batch.json`:

```json
{
  "items": [
    {
      "id": "duplicate-prop",
      "code": "export const App = () => <div id=\"a\" id=\"b\" />;",
      "rule": {
        "key": "react-doctor/jsx-no-duplicate-props",
        "description": "An explicit JSX attribute name must occur only once on each element.",
        "exceptions": ["Names are case sensitive. Ignore spread attributes."]
      },
      "detected": true
    }
  ]
}
```

`detected` is optional. Set it to `false` only if React Doctor completed the
requested check without a finding. Omit it if the check failed, was skipped, or
was unavailable. This API does not run React Doctor itself.

Use `filePath`, `framework`, `project`, and `buildEvidence` when they affect the
rule. Use a one-based `line` to assess a specific location. Without a line, Jev
assesses the whole supplied file. The detector result must cover the same scope.
Rule descriptions must include the intended behavior and exceptions. A rule name
alone is not enough to establish that contract.

Limits: 100 items per batch, 48,000 code characters per item, and 16 concurrent
assessments. The default concurrency is 8. Results keep input order and include
the input index. Invalid items return `error`; an invalid batch is rejected.

## Node API

From a TypeScript script in this package:

```ts
import { gradeCodeBatch } from "./src/grade-code-batch.js";

const result = await gradeCodeBatch({ items });
console.log(result.results);
console.log(result.summary);
```

Set `AI_GATEWAY_API_KEY` in the process environment for live calls. You can inject
an evaluator through `options.evaluator` for tests. Its `id` must identify the
model and evaluation behavior, because it forms part of the cache key.

## Local HTTP API

Set `CODE_GRADING_API_KEY` to a separate random client authentication token
(for example, generate one with `openssl rand -hex 32`). Then, from
`packages/evals`, run:

```sh
nr grade:serve
```

The server binds to `127.0.0.1:8787`. Submit a batch:

```sh
curl http://127.0.0.1:8787/v1/check \
  -H "Authorization: Bearer $CODE_GRADING_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @batch.json
```

The server requires authentication, limits request bodies to 8 MB, and accepts
two active batches. It rejects duplicate authorization headers, compressed
uploads, and content types other than `application/json`. Connection limits and
body deadlines apply before model work starts. It returns HTTP 200 when it can deliver per-item results,
including item failures. Check each `verdict`. HTTP 400 means an invalid batch;
401 means invalid authentication; 408 means an upload timed out; 413 means the
body is too large; 415 means an unsupported content type or encoding; 429 means a
rate limit was reached; 503 means the server is busy. Rate-limit and busy responses
include `Retry-After`.

The default limits are:

| Control                                                      | Limit                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Authenticated requests                                       | Burst of 60, refilled at 60 per minute                    |
| Submitted items, including cache hits                        | Burst of 1,000, refilled at 1,000 per minute              |
| Requests per socket address, including failed authentication | Burst of 120, refilled at 120 per minute                  |
| Active model calls across all requests                       | 8                                                         |
| Open connections                                             | 32                                                        |
| Request headers                                              | 8 KiB and 10 seconds                                      |
| Request body                                                 | 8 MB and 10 seconds                                       |
| Cached assessments                                           | 1,000 entries, one-hour TTL, least recently used eviction |
| Nested input                                                 | 32 levels, 10,000 nodes and 100,000 characters per item   |

Configure request and item budgets with `createCodeGradingServer({ apiKey,
rateLimit: { requests, items, addressRequests, windowMs } })`. The address limit
uses the socket peer and ignores `X-Forwarded-For`. Its address table is bounded;
idle addresses can expire after the refill window. Identical in-flight
assessments share work across requests. A client disconnect stops its queued
work; a shared model call is aborted only when no clients need it. Calls have a
60-second deadline, and failures or late results never enter the cache.

Cache reads do not extend TTL. Restarting the server clears its memory cache. The endpoint is local; it is not deployed on
`react.doctor`. All limits and shared calls are local to one server process.

## Vercel hosting and bot protection

`src/server.ts` is the Vercel entrypoint. Create a separate Vercel project with
Root Directory `packages/evals` and include files outside that directory for the
workspace lockfile. The checked-in `vercel.json` selects the Node server and the
`iad1` region. Set `CODE_GRADING_API_KEY` and `AI_GATEWAY_API_KEY` as sensitive
server environment variables. Enable Vercel system environment variables; the
server uses `VERCEL_PROJECT_PRODUCTION_URL` as a fixed firewall host. It rejects
local development mode; use `grade:serve` for local work.

Before admitting traffic, configure and publish these Vercel Firewall rules:

1. An SDK rate-limit rule with ID `code-grading-batches`, **10 requests per
   60 seconds**, with a deny action. Match the `@vercel/firewall` rate-limit ID
   without additional header or path conditions. Every authenticated batch uses
   the same account bucket, across replicas. A batch can contain at most 100
   items, so this caps admitted items at 1,000 per window per firewall region.
2. An edge rule for `/v1/check`: rate-limit each client IP to 120 requests per
   60 seconds, with a deny action. This protects authentication and upload work
   before it reaches the function. Also deny other application paths and methods;
   preserve `/.well-known/vercel/rate-limit-api/*` for the SDK.
3. Keep Deployment Protection on previews. Configure the automation bypass
   secret for the SDK as described in Vercel's rate-limit guide. Set a Vercel AI
   Gateway spending limit for this project's key as a separate cost cap.

The SDK gate runs after authentication and before reading the body or calling
Jev. It returns 429 on a limit or block, and 503 if the rule is missing, a check
fails, or the check exceeds one second. A failed check closes admission for that
process until it restarts. This prevents stalled SDK requests from accumulating;
SDK 1.2.5 has no fetch timeout option. The dependency stays within this repo's
minimum release age policy. No client headers, credentials, or source code are
forwarded to the firewall. The cache remains bounded and local to each replica.
Vercel WAF counters are regional, not a global spending limit. Keep the single
function region and use the Gateway cap for account-wide spend control.

Do not apply a browser challenge to this machine endpoint. Vercel BotID requires
browser-generated challenge data and would reject the CLI and GitHub workflow.
If a browser form is added later, protect its separate submission route with
BotID and have its server call this authenticated API. Use WAF deny rules and
rate limits for automated abuse of `/v1/check`.

Deployment verification: valid auth must grade a sample; invalid auth must return
401; exceeding the shared quota must return 429; deleting the SDK rule must return
503 with zero model calls. Repeat from two clients against the same deployment.
These rules require project configuration. Local tests do not prove that deployed
edge protection is active. This change does not deploy the service.

References: [Node servers on Vercel](https://vercel.com/docs/functions/runtimes/node-js),
[Firewall rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk),
and [BotID setup](https://vercel.com/docs/botid/get-started).

## Files and offline use

```sh
nr grade --input batch.json --output grades.json --cache cache.json
nr grade --input batch.json --output offline.json --cache cache.json --offline
```

Offline mode makes no model calls. A matching cached assessment returns a grade;
a cache miss returns `unavailable`. A live model failure returns `error` and is
not cached. Valid grades remain available when another item fails.

The cache key includes code, rule contract, context, evaluator identity, and
prompt and assessment versions. It excludes the detector result. This lets you
compare a changed detector against the same independent assessment. Identical
assessments share one model call within a batch. `summary.modelCalls` counts the
actual calls. Cache files contain assessments, not source code. Treat cache
files as trusted local artifacts; they are not signed. File cache records retain
the original expiry time and are bounded to 1,000 entries. Expired records are
not replayed.

## Verdicts

| Jev assessment                     | React Doctor result | Verdict                |
| ---------------------------------- | ------------------- | ---------------------- |
| Violation                          | Finding             | `likely_tp`            |
| Violation                          | No finding          | `candidate_fn`         |
| Valid                              | Finding             | `candidate_fp`         |
| Valid                              | No finding          | `likely_tn`            |
| Violation or valid                 | Unavailable         | `violation` or `valid` |
| Missing evidence or low confidence | Any                 | `review`               |
| Offline cache miss                 | Any                 | `unavailable`          |
| Invalid item or provider failure   | Any                 | `error`                |

Both answer confidence and context confidence must reach 0.90. Jev does not see
the detector result. Model grades identify candidates for review; they are not
human labels or measured precision and recall. Review an FP/FN candidate, retain
a regression case, fix the detector, then compare the new detector result with
the cached assessment. Include both reported findings and silent code to find
both kinds of error.

## GitHub workflow

The manual **Grade code with Jev** workflow accepts the same JSON batch. Configure
the repository secret `AI_GATEWAY_API_KEY`, run the workflow on `main`, and download the
`code-grading-results` artifact. The workflow stores results for seven days and
prints only counts to its log. Actions are pinned to commit SHAs, and only one
grading workflow runs at a time. The secret is scoped to the grading step. Item failures do not prevent artifact delivery.
This workflow does not change rules, post comments, or publish a release.

## Product check

Job: rule authors need to check small code samples without a repository scan or
sandbox setup. Reuse: the existing Jev adapter, assessment schema, confidence
gates, evidence scrubber, and concurrency limiter. Measure: the returned
`summary.byVerdict` shows how many submitted items receive usable grades, review,
or errors. Review this private interface after 20 real batches; revise it if more
than half of items still require review because the contract or context is too
weak. Keep the existing confidence gates. No scheduled task is created.
