import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPulsingStatusDot } from "./no-pulsing-status-dot.js";

describe("no-pulsing-status-dot", () => {
  it("flags tiny round pulse and ping indicators in bounded chrome and hero contexts", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Page = () => (
        <>
          <header><span className="size-2 rounded-full bg-green-500 animate-pulse" /></header>
          <nav><i className="h-4 w-4 rounded-full animate-ping" /></nav>
          <div role="navigation"><span className="size-1 rounded-full animate-pulse" /></div>
          <aside role="navigation"><span className="size-3 rounded-full animate-ping" /></aside>
          <section><h1>Reliable infrastructure</h1><span className="size-[2px] rounded-full animate-ping" /></section>
          <header><span className="size-[1rem] rounded-full animate-pulse" /></header>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(6);
  });

  it("flags resolved non-live semantics and explicitly disabled live semantics", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Header = () => (
        <header>
          <span role="presentation" className="size-3 rounded-full animate-pulse" />
          <span aria-busy={false} className="size-3 rounded-full animate-pulse" />
          <div aria-busy="false"><span className="size-3 rounded-full animate-pulse" /></div>
          <div aria-busy={"false"}><span className="size-3 rounded-full animate-pulse" /></div>
          <div aria-live="off"><span className="size-3 rounded-full animate-pulse" /></div>
        </header>
      );`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("allows genuine and unresolved busy or progress semantics", () => {
    const attributes = [
      "aria-busy",
      'aria-busy="true"',
      "aria-busy={true}",
      "aria-busy={busy}",
      'role="status"',
      'role="status fallback"',
      'role="progressbar"',
      "role={role}",
      "{...props}",
    ];
    for (const attributesSource of attributes) {
      const result = runRule(
        noPulsingStatusDot,
        `const Header = ({ busy, role, props }) => <header><span ${attributesSource} className="size-2 rounded-full animate-pulse" /></header>;`,
      );
      expect(result.diagnostics, attributesSource).toHaveLength(0);
    }
  });

  it("allows inherited enabled or unresolved live status semantics", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Page = ({ busy, live, role, props }) => (
        <>
          <header aria-busy><span className="size-2 rounded-full animate-pulse" /></header>
          <header aria-busy={busy}><span className="size-2 rounded-full animate-pulse" /></header>
          <header aria-live="polite"><span className="size-2 rounded-full animate-pulse" /></header>
          <header aria-live={live}><span className="size-2 rounded-full animate-pulse" /></header>
          <header role="alert"><span className="size-2 rounded-full animate-pulse" /></header>
          <header role="presentation status"><span className="size-2 rounded-full animate-pulse" /></header>
          <header role={role}><span className="size-2 rounded-full animate-pulse" /></header>
          <header {...props}><span className="size-2 rounded-full animate-pulse" /></header>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows pulses outside header, navigation, and hero sections", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Content = () => (
        <main>
          <span className="size-2 rounded-full animate-pulse" />
          <section><h2>Activity</h2><span className="size-2 rounded-full animate-ping" /></section>
          <aside><span className="size-2 rounded-full animate-pulse" /></aside>
        </main>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows statically hidden dots and hidden ancestor subtrees", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Header = () => (
        <header>
          <span hidden className="size-2 rounded-full animate-pulse" />
          <span aria-hidden="true" className="size-2 rounded-full animate-pulse" />
          <span className="hidden size-2 rounded-full animate-pulse" />
          <span className="invisible size-2 rounded-full animate-pulse" />
          <div className="invisible"><span className="size-2 rounded-full animate-pulse" /></div>
          <div style={{ display: "none" }}><span className="size-2 rounded-full animate-pulse" /></div>
        </header>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows non-dot shapes, populated elements, and sizes outside the tiny range", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Header = () => (
        <header>
          <span className="size-2 rounded-md animate-pulse" />
          <span className="h-2 w-3 rounded-full animate-pulse" />
          <span className="size-[1px] rounded-full animate-pulse" />
          <span className="size-[17px] rounded-full animate-pulse" />
          <span className="size-5 rounded-full animate-pulse" />
          <span className="size-2 rounded-full animate-pulse">Online</span>
        </header>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows other, conditional, overridden, and ambiguous animations", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Header = () => (
        <header>
          <span className="size-2 rounded-full animate-spin" />
          <span className="size-2 rounded-full animate-bounce" />
          <span className="size-2 rounded-full hover:animate-pulse" />
          <span className="size-2 rounded-full animate-pulse !animate-spin" />
          <span className="size-2 rounded-full animate-pulse animate-spin" />
        </header>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unresolved styling and custom components", () => {
    const result = runRule(
      noPulsingStatusDot,
      `const Header = ({ className }) => (
        <header>
          <span className={className} />
          <span style={{ backgroundColor: "green" }} className="size-2 rounded-full animate-pulse" />
          <StatusDot className="size-2 rounded-full animate-pulse" />
        </header>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
