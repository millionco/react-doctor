import { describe, expect, it } from "vite-plus/test";
import type { Event } from "@sentry/node";
import { scrubSentryEvent } from "../src/cli/utils/scrub-sentry-event.js";

const buildEvent = (): Event => ({
  server_name: "janes-macbook.local",
  user: { id: "u1", ip_address: "{{auto}}" },
  message: "failed scanning /Users/jane/app",
  contexts: {
    device: { name: "janes-macbook.local", arch: "arm64" },
    trace: {
      trace_id: "11111111111111111111111111111111",
      span_id: "2222222222222222",
      data: { "inspect.directory": "/Users/jane/app" },
    },
  },
  extra: { leakedPath: "/home/jane/secret/app" },
  tags: { framework: "nextjs" },
  breadcrumbs: [{ message: "read /Users/jane/app/x.ts", data: { path: "/Users/jane/y" } }],
  exception: {
    values: [
      {
        type: "Error",
        value: "boom at /Users/jane/app/x.ts",
        stacktrace: {
          frames: [
            {
              filename: "/Users/jane/app/x.ts",
              abs_path: "/Users/jane/app/x.ts",
              vars: { token: "secret-value" },
            },
          ],
        },
      },
    ],
  },
  spans: [
    {
      data: { "inspect.directory": "/Users/jane/app" },
      span_id: "3333333333333333",
      trace_id: "11111111111111111111111111111111",
      start_timestamp: 1,
      description: "runInspect",
    },
  ],
});

describe("scrubSentryEvent", () => {
  it("strips machine/person identity (server_name, user, device name)", () => {
    const scrubbed = scrubSentryEvent(buildEvent());
    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.server_name).toBeUndefined();
    expect(scrubbed?.user).toBeUndefined();
    expect(scrubbed?.contexts?.device?.name).toBeUndefined();
  });

  it("scrubs home-directory paths everywhere they can hide", () => {
    const scrubbed = scrubSentryEvent(buildEvent());
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("/Users/jane");
    expect(serialized).not.toContain("/home/jane");
    expect(scrubbed?.message).toBe("failed scanning ~/app");
    expect(scrubbed?.exception?.values?.[0]?.value).toBe("boom at ~/app/x.ts");
    expect(scrubbed?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe("~/app/x.ts");
    expect(scrubbed?.spans?.[0]?.data?.["inspect.directory"]).toBe("~/app");
  });

  it("drops captured local variables from stack frames", () => {
    const scrubbed = scrubSentryEvent(buildEvent());
    expect(scrubbed?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it("masks known secrets that leak into free text", () => {
    const event = buildEvent();
    event.message = "leaked ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed?.message).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(scrubbed?.message).toContain("ghp_<redacted>");
  });

  it("keeps anonymous diagnostic data intact", () => {
    const scrubbed = scrubSentryEvent(buildEvent());
    expect(scrubbed?.tags?.framework).toBe("nextjs");
    expect(scrubbed?.spans?.[0]?.description).toBe("runInspect");
  });
});
