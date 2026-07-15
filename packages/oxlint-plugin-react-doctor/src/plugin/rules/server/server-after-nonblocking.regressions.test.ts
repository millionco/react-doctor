import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverAfterNonblocking } from "./server-after-nonblocking.js";

describe("server/server-after-nonblocking — regressions", () => {
  it("flags an analytics call inside a server action", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
export async function save(data) {
  analytics.track("saved", data);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the `analytics` receiver is wrapped in `as any`", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
export async function save(data) {
  (analytics as any).track("saved", data);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag console.info wrapped in after() from next/server", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function uploadDocument(formData) {
  after(() => console.info(JSON.stringify({ event: "upload_ok" })));
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag console.warn in an async after() block", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function uploadWithBlock(formData) {
  after(async () => {
    try {
      await sendEmail();
    } catch (err) {
      console.warn("email failed:", err);
    }
  });
  return { success: true };
}

async function sendEmail() {}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag analytics.track wrapped in after()", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function save(data) {
  after(() => analytics.track("saved", data));
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when after is imported with an alias", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after as defer } from "next/server";

export async function save(data) {
  defer(() => console.log("deferred"));
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag unstable_after from next/server", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { unstable_after } from "next/server";

export async function save(data) {
  unstable_after(() => console.log("deferred"));
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags console calls outside of after()", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function save(data) {
  console.log("before after");
  after(() => console.log("inside after"));
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("console.log()");
  });

  it("still flags nested console calls outside after() even when after is imported", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function save(data) {
  const helper = () => {
    console.log("not in after");
  };
  helper();
  return { success: true };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
