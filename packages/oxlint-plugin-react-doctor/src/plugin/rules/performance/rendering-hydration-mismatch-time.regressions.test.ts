import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHydrationMismatchTime } from "./rendering-hydration-mismatch-time.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingHydrationMismatchTime, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingHydrationMismatchTime, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-hydration-mismatch-time — regressions", () => {
  it("does not flag Date.now() inside an event-handler arrow", () => {
    expectPass(`
      export const Row = () => (
        <button onClick={() => track(Date.now())}>Save</button>
      );
    `);
  });

  it("does not flag new Date() inside a function-expression handler body", () => {
    expectPass(`
      export const Field = () => (
        <input onChange={function handleChange() { setStamp(new Date()); }} />
      );
    `);
  });

  it("still flags a bare {Date.now()} child", () => {
    expectFail(`export const Stamp = () => <time>{Date.now()}</time>;`);
  });

  it("still flags chained new Date().toLocaleString()", () => {
    expectFail(`export const Banner = () => <span>{new Date().toLocaleString()}</span>;`);
  });

  it("still flags Math.random() reached through an attribute expression", () => {
    expectFail(`export const Tip = () => <p data-roll={String(Math.random())}>hi</p>;`);
  });

  it("does not flag the mined ant-design shape: Date.now() in a JSX attribute inside a jest test file", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export const Case = () => <Statistic.Timer type="countdown" value={Date.now() + 1500} />;`,
      { filename: "components/statistic/__tests__/index.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a story file either", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export const Demo = () => <time>{Date.now()}</time>;`,
      { filename: "src/components/clock.stories.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date() inside JSX rendered by next/og ImageResponse", () => {
    expectPass(`
      import { ImageResponse } from "next/og";
      export async function GET() {
        return new ImageResponse(
          <div>
            <p>{formatDate(new Date())}</p>
          </div>,
        );
      }
    `);
  });

  it("does not flag Date.now() in an opengraph-image file", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export default function Image() {
        return <div>{Date.now()}</div>;
      }`,
      { filename: "app/blog/opengraph-image.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an IIFE returning new Date().toLocaleString()", () => {
    expectFail(`export const Banner = () => <span>{(() => new Date().toLocaleString())()}</span>;`);
  });

  it("still flags useMemo(() => Date.now(), []) inline in JSX", () => {
    expectFail(`export const Stamp = () => <time>{useMemo(() => Date.now(), [])}</time>;`);
  });

  it("does not flag a useCallback handler factory inline in JSX", () => {
    expectPass(
      `export const Row = () => <button onClick={useCallback(() => track(Date.now()), [])}>go</button>;`,
    );
  });
});
