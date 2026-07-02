import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoClientFetchForServerData } from "./nextjs-no-client-fetch-for-server-data.js";

describe("nextjs/nextjs-no-client-fetch-for-server-data — regressions", () => {
  it("stays silent on fetch inside an event handler declared in the effect", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    const onSubmit = () => { fetch("/api/save", { method: "POST" }); };
    document.forms[0].addEventListener("submit", onSubmit);
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a direct fetch in the effect body", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { fetch("/api/data"); }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an async arrow declared in the effect and invoked immediately", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect, useState } from "react";
export default function Page() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/data");
      setData(await response.json());
    };
    load();
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an async IIFE inside the effect", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    (async () => {
      await fetch("/api/data");
    })();
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an inner function declaration invoked immediately", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    async function load() {
      await fetch("/api/data");
    }
    load();
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a direct fetch().then() in the effect body", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    fetch("/api/data").then((response) => response.json());
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the fetch-calling handler is only registered, with a cleanup return", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    const onSubmit = () => { fetch("/api/save", { method: "POST" }); };
    document.forms[0].addEventListener("submit", onSubmit);
    return () => document.forms[0].removeEventListener("submit", onSubmit);
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
