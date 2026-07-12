import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsAsyncClientComponent } from "./nextjs-async-client-component.js";

describe("nextjs/nextjs-async-client-component — regressions", () => {
  it('flags an async component in a "use client" file', () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
export default async function Profile() {
  const data = await loadProfile();
  return <div>{data.name}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('stays silent for an async component without "use client"', () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `export default async function Profile() {
  const data = await loadProfile();
  return <div>{data.name}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["freeze", "seal"])(
    "flags an async client component wrapped with Object.%s",
    (methodName) => {
      const result = runRule(
        nextjsAsyncClientComponent,
        `"use client";
const Profile = Object.${methodName}(async () => {
  const data = await loadProfile();
  return <div>{data.name}</div>;
});`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("flags an async client component through nested integrity wrappers", () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
const Profile = Object.freeze(Object.seal(async () => <div />));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async client component when the integrity callee has a TypeScript wrapper", () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
const Profile = (Object.freeze as typeof Object.freeze)(async () => <div />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a wrapped synchronous client component", () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
const Profile = Object.freeze(() => <div />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a wrapped async server component", () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `const Profile = Object.freeze(async () => <div />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a shadowed Object.freeze implementation", () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
const Object = { freeze: () => SharedProfile };
const Profile = Object.freeze(async () => <div />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
