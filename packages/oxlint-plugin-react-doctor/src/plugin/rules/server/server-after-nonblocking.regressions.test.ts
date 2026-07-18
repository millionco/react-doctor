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

  it("does not flag a const alias of the imported after binding through TypeScript wrappers", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const schedule = after as typeof after;
const defer = schedule;

export async function save() {
  (defer as typeof after)((() => console.info("deferred")) satisfies () => void);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag static computed calls through a next/server namespace alias", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import * as NextServer from "next/server";

const serverApi = NextServer as typeof NextServer;

export async function save() {
  serverApi[\`after\`]((() => analytics.track("saved")) as () => void);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after destructured from the proven next/server namespace", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import * as NextServer from "next/server";

const { after: defer } = NextServer;

export async function save() {
  defer(() => console.info("deferred"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an extracted const callback used only by after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = (() => {
  console.info("saved");
}) satisfies () => void;

export async function save() {
  after(reportSaved as () => void);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an extracted function declaration used only by after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

function reportSaved() {
  analytics.track("saved");
}

export async function save() {
  after(reportSaved);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a helper reached only through a callback scheduled by after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = () => console.info("saved");

export async function save() {
  after(() => withTracing(reportSaved));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag nested callbacks that cannot exist before the after callback runs", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function save() {
  after(() => {
    const reportSaved = () => console.info("saved");
    queueMicrotask(reportSaved);
  });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag callback self-references that can only run after the deferred entry", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

let remaining = 1;
const reportSaved = () => {
  console.info("saved");
  if (remaining-- > 0) reportSaved();
};

export async function save() {
  after(reportSaved);
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

  it("still flags a shadowing parameter named after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export async function save(after) {
  after(() => console.log("synchronous userland callback"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a shadowed next/server namespace", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import * as NextServer from "next/server";

export async function save() {
  const NextServer = { after: (callback) => callback() };
  NextServer.after(() => console.log("synchronous userland callback"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags userland after lookalikes", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "./scheduler";
import * as Scheduler from "./scheduler";

export async function save() {
  after(() => console.info("first"));
  Scheduler["after"](() => console.info("second"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags dynamic computed properties on the next/server namespace", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import * as NextServer from "next/server";

export async function save(method) {
  NextServer[method](() => console.log("not statically proven"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags nested destructuring that does not select next/server after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import * as NextServer from "next/server";

const { scheduler: { after: defer } } = NextServer;

export async function save() {
  defer(() => console.log("not the proven API"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags callbacks in non-callback argument positions", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = () => console.info("saved");

export async function save() {
  after(Promise.resolve(), reportSaved);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an extracted callback that is also called synchronously", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = () => console.info("saved");

export async function save() {
  after(reportSaved);
  reportSaved();
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an extracted callback that escapes outside after", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const callbacks = [];
const reportSaved = () => console.info("saved");

export async function save() {
  after(reportSaved);
  callbacks.push(reportSaved);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback hidden behind an unproven module-scope wrapper", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = () => console.info("saved");

export async function save() {
  after(withTracing(reportSaved));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a callback routed through an unproven alias", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

const reportSaved = () => console.info("saved");
const aliasedReport = reportSaved;

export async function save() {
  after(aliasedReport);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags directly exported callbacks that can be invoked elsewhere", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

export const reportSaved = () => console.info("saved");

export async function save() {
  after(reportSaved);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags mutable aliases of after because their call target is uncertain", () => {
    const result = runRule(
      serverAfterNonblocking,
      `"use server";
import { after } from "next/server";

let defer = after;

export async function save() {
  defer(() => console.info("not statically proven"));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
