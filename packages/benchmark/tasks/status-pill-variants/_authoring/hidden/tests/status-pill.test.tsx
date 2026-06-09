import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPill, type PillStatus } from "../src/status-pill.tsx";

const CASES: Array<{ status: PillStatus; label: string }> = [
  { status: "success", label: "Success" },
  { status: "error", label: "Error" },
  { status: "warning", label: "Warning" },
  { status: "info", label: "Info" },
];

for (const { status, label } of CASES) {
  test(`renders the ${status} pill`, () => {
    const html = renderToStaticMarkup(<StatusPill status={status} />);
    expect(html).toContain(`pill pill-${status}`);
    expect(html).toContain(`>${label}<`);
  });
}
