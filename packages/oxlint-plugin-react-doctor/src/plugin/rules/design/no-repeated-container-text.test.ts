import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { REPEATED_CONTAINER_TEXT_MAX_DESCENDANT_COUNT } from "../../constants/design.js";
import { noRepeatedContainerText } from "./no-repeated-container-text.js";

describe("no-repeated-container-text", () => {
  it("reports the same short literal in three distinct card slots", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const StatusCard = () => (
        <article className="rounded-xl border bg-white p-6">
          <div className="headline"><strong>Suspended</strong></div>
          <div className="metadata"><span>Suspended</span></div>
          <p className="notice">Service is <em>Suspended</em> until further notice.</p>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Suspended");
  });

  it("supports static string expression children", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const TicketCard = () => (
        <section className="rounded-lg shadow-md bg-white p-5">
          <header><strong>{"Unavailable"}</strong></header>
          <div className="details"><span>{\`Unavailable\`}</span></div>
          <footer><em>{"Unavailable"}</em></footer>
        </section>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows repeated text in parallel sibling rows", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Departures = () => (
        <section className="rounded-xl border bg-white p-6">
          <div className="row"><span className="status">On schedule</span></div>
          <div className="row"><span className="status">On schedule</span></div>
          <div className="row"><span className="status">On schedule</span></div>
        </section>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows repetition in tables, lists, menus, selects, code, and data visualizations", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const StructuredContent = () => (
        <div className="rounded-xl border bg-white p-6">
          <table><tbody><tr><td>Rolled back</td></tr><tr><td>Rolled back</td></tr><tr><td>Rolled back</td></tr></tbody></table>
          <ul><li>Queued job</li><li>Queued job</li><li>Queued job</li></ul>
          <menu><li>Open panel</li><li>Open panel</li><li>Open panel</li></menu>
          <select><option>Primary region</option><option>Primary region</option><option>Primary region</option></select>
          <pre><code><span>const value</span><em>const value</em><strong>const value</strong></code></pre>
          <div role="grid"><span>Open slot</span><em>Open slot</em><strong>Open slot</strong></div>
          <svg><text>Chart label</text><text>Chart label</text><text>Chart label</text></svg>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count skipped subtrees toward the descendant limit", () => {
    const skippedControls = Array.from(
      { length: REPEATED_CONTAINER_TEXT_MAX_DESCENDANT_COUNT + 1 },
      (_, controlIndex) => `<button>Action ${controlIndex}</button>`,
    ).join("");
    const result = runRule(
      noRepeatedContainerText,
      `const StatusCard = () => (
        <article className="rounded-xl border bg-white p-6">
          ${skippedControls}
          <div className="headline"><strong>Suspended</strong></div>
          <div className="metadata"><span>Suspended</span></div>
          <p className="notice">Service is <em>Suspended</em> until further notice.</p>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows intentional repeated controls and hidden copies", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Actions = () => (
        <aside className="rounded-xl border bg-white p-6">
          <button><span>View details</span></button>
          <a href="/details"><em>View details</em></a>
          <label><strong>View details</strong><input /></label>
          <div hidden><span>Archived state</span><em>Archived state</em><strong>Archived state</strong></div>
          <div aria-hidden="true"><span>Visual copy</span><em>Visual copy</em><strong>Visual copy</strong></div>
        </aside>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows inline-hidden and visually-hidden copies", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const HiddenCopies = () => (
        <article className="rounded-xl border bg-white p-6">
          <div style={{ display: "none" }}><span>Archived state</span><em>Archived state</em><strong>Archived state</strong></div>
          <div style={{ visibility: "hidden" }}><span>Pending state</span><em>Pending state</em><strong>Pending state</strong></div>
          <div className="sr-only"><span>Screen reader copy</span><em>Screen reader copy</em><strong>Screen reader copy</strong></div>
          <div className="visually-hidden"><span>Accessible copy</span><em>Accessible copy</em><strong>Accessible copy</strong></div>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("collects visible repeated text through a static style binding", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const visibleStyles = { color: "red" };
      const StatusCard = () => (
        <article className="rounded-xl border bg-white p-6">
          <div style={visibleStyles} className="headline"><strong>Suspended</strong></div>
          <div className="metadata"><span>Suspended</span></div>
          <p className="notice">Service is <em>Suspended</em> until further notice.</p>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("collects repeated text when visibility cannot be resolved", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const StatusCard = () => (
        <article className="rounded-xl border bg-white p-6">
          <div className="hover:hidden"><strong>Suspended</strong></div>
          <div className="metadata"><span>Suspended</span></div>
          <p className="notice">Service is <em>Suspended</em> until further notice.</p>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects cards containing responsive visibility copies", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const ResponsiveCard = () => (
        <article className="rounded-xl border bg-white p-6">
          <div className="mobile hidden md:block"><span>Unavailable</span></div>
          <div className="tablet md:hidden lg:block"><em>Unavailable</em></div>
          <div className="desktop hidden lg:block"><strong>Unavailable</strong></div>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows repetition inside figures and graphics semantics", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Visualizations = () => (
        <section className="rounded-xl border bg-white p-6">
          <figure><span>Conversion rate</span><em>Conversion rate</em><strong>Conversion rate</strong></figure>
          <div role="img"><span>Revenue trend</span><em>Revenue trend</em><strong>Revenue trend</strong></div>
          <div role="graphics-document"><span>System map</span><em>System map</em><strong>System map</strong></div>
          <div role="graphics-symbol"><span>Legend item</span><em>Legend item</em><strong>Legend item</strong></div>
          <div role="diagram"><span>Request flow</span><em>Request flow</em><strong>Request flow</strong></div>
        </section>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows containers with dynamic children", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const DynamicCard = ({ status, items }) => (
        <article className="rounded-xl border bg-white p-6">
          <header><strong>Unavailable</strong></header>
          <div className="details"><span>Unavailable</span></div>
          <footer><em>Unavailable</em></footer>
          {items.map((item) => <span key={item.id}>{item.label}</span>)}
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer repeated output through custom components", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const ComponentCard = () => (
        <article className="rounded-xl border bg-white p-6">
          <CardHeader>Unavailable</CardHeader>
          <StatusBadge>Unavailable</StatusBadge>
          <CardFooter>Unavailable</CardFooter>
        </article>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine repeated labels across separate cards or nested cards", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Cards = () => (
        <main>
          <article className="rounded-xl border bg-white p-6"><span>Standby mode</span></article>
          <article className="rounded-xl border bg-white p-6"><em>Standby mode</em></article>
          <article className="rounded-xl border bg-white p-6"><strong>Standby mode</strong></article>
          <section className="rounded-2xl border bg-white p-8">
            <div className="rounded-lg border bg-white p-4"><span>Review pending</span></div>
            <div className="rounded-lg border bg-white p-4"><em>Review pending</em></div>
            <div className="rounded-lg border bg-white p-4"><strong>Review pending</strong></div>
          </section>
        </main>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires three eligible occurrences in distinct structural paths", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Cards = () => (
        <>
          <article className="rounded-xl border bg-white p-6">
            <div className="headline"><span>Rescheduled</span></div>
            <div className="metadata"><em>Rescheduled</em></div>
          </article>
          <article className="rounded-xl border bg-white p-6">
            <div className="first"><span>Off</span></div>
            <div className="second"><em>Off</em></div>
            <div className="third"><strong>Off</strong></div>
          </article>
          <article className="rounded-xl border bg-white p-6">
            <div className="first"><span>2026</span></div>
            <div className="second"><em>2026</em></div>
            <div className="third"><strong>2026</strong></div>
          </article>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a statically recognizable Tailwind card surface", () => {
    const result = runRule(
      noRepeatedContainerText,
      `const Plain = ({ className }) => (
        <>
          <div className="border bg-white p-6"><span>Unavailable</span><em>Unavailable</em><strong>Unavailable</strong></div>
          <div className={className}><span>Suspended</span><em>Suspended</em><strong>Suspended</strong></div>
          <div style={{ border: "1px solid", borderRadius: 12 }}><span>Pending review</span><em>Pending review</em><strong>Pending review</strong></div>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
