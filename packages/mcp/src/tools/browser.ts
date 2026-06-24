import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { closeLaunchedBrowser, DEFAULT_TRACE_FILENAME, parseViewport } from "@react-doctor/browser";
import { DEFAULT_CDP_ENDPOINT_HINT } from "../constants.js";
import { jsonResult, runTool, textResult } from "../utils/tool-result.js";
import { withSession, type BrowserToolConnection } from "../utils/with-session.js";

const connectionShape = {
  cdp: z
    .string()
    .optional()
    .describe(`CDP endpoint to attach to (default ${DEFAULT_CDP_ENDPOINT_HINT})`),
  noLaunch: z
    .boolean()
    .optional()
    .describe("Fail instead of launching Chrome when no attach target exists"),
  headed: z
    .boolean()
    .optional()
    .describe("Show the launched browser window (the launched Chrome is headless by default)"),
};

const viewportShape = {
  viewport: z
    .string()
    .optional()
    .describe("Emulate a viewport for this call, WIDTHxHEIGHT in pixels (e.g. 390x844)"),
};

interface ConnectionArgs {
  cdp?: string;
  noLaunch?: boolean;
  headed?: boolean;
  viewport?: string;
}

const toConnection = (args: ConnectionArgs): BrowserToolConnection => ({
  cdp: args.cdp,
  noLaunch: args.noLaunch,
  headed: args.headed,
  viewport: args.viewport ? parseViewport(args.viewport) : undefined,
});

export const registerBrowserTools = (server: McpServer): void => {
  server.registerTool(
    "browser_open",
    {
      title: "Open a URL with the React profiler",
      description:
        "Open a URL in the attached Chrome and keep the page, injecting the React DevTools profiler so a later browser_eval with profile:true can capture React renders. Attaches to your running Chrome over CDP, launching a dedicated one only as a fallback.",
      inputSchema: { url: z.string().describe("URL to open"), ...connectionShape },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        await withSession(toConnection(args), (session) => session.openWithReactProfiler(args.url));
        return textResult(
          `Opened ${args.url}. To measure an action, call browser_eval with profile:true and an expression, e.g. page.getByText("Load more").click().`,
        );
      }),
  );

  server.registerTool(
    "browser_eval",
    {
      title: "Run Playwright code, optionally profiling it",
      description:
        'Run Playwright code with the `page` in scope (e.g. page.getByRole("button", { name: "Login" }).click()) against the attached page. Locate with the accessibility tree (browser_snapshot, or page.locator(...).ariaSnapshot() for a subtree) then act. By default: an expression that returns a value yields the value; an expression that just acts (returns nothing) yields the resulting accessibility tree, so one call drives the page and shows the new state. Multi-statement source works without wrapping it yourself. Page globals (window/document) live in the page — reach them via page.evaluate(() => ...). Set profile:true to instead record and return the full runtime picture while the code runs. Open the page first with browser_open for React render data.',
      inputSchema: {
        expression: z
          .string()
          .optional()
          .describe(
            "Playwright code with `page` in scope (single expression or multiple statements); omit together with profile:true to measure the live page idle",
          ),
        profile: z
          .boolean()
          .optional()
          .describe(
            "Set true to record and return the full runtime picture while the expression runs — console, network (failures, plus each request's time and transfer size, with slow/heavy ones flagged), performance (LoAF jank/LCP/CLS plus a `timeline` roll-up of forced style-recalc/layout/hit-test/paint cost from a DevTools trace), memory (JS heap, DOM nodes, listeners, documents/frames — watch these climb across runs for leaks), accessibility, the React render profile (slow commits, hot components, unnecessary re-renders), and a V8 CPU profile. Also writes the raw timeline trace to `out` (loadable in DevTools) and returns its path as `tracePath`. Omit for just the expression's return value.",
          ),
        out: z
          .string()
          .optional()
          .describe(
            `With profile:true, write the raw DevTools timeline trace here (default ${DEFAULT_TRACE_FILENAME} in the working directory)`,
          ),
        ...connectionShape,
        ...viewportShape,
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        if (args.profile) {
          return jsonResult(
            await withSession(toConnection(args), (session) =>
              session.inspect({
                expression: args.expression,
                tracePath: args.out ?? DEFAULT_TRACE_FILENAME,
              }),
            ),
          );
        }
        if (args.expression === undefined) return textResult("(no value)");
        const expression = args.expression;
        return textResult(
          await withSession(toConnection(args), (session) =>
            session.evaluateOrSnapshot(expression),
          ),
        );
      }),
  );

  server.registerTool(
    "browser_snapshot",
    {
      title: "Snapshot the page's accessibility tree",
      description:
        "Return the attached page's accessibility tree — a stable, text view of what is rendered, useful for locating elements before driving them with browser_eval.",
      inputSchema: { ...connectionShape, ...viewportShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () =>
        textResult(await withSession(toConnection(args), (session) => session.snapshot())),
      ),
  );

  server.registerTool(
    "browser_screenshot",
    {
      title: "Screenshot the page",
      description: "Capture a screenshot of the attached page as a PNG image.",
      inputSchema: { ...connectionShape, ...viewportShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const bytes = await withSession(toConnection(args), (session) => session.screenshot());
        return {
          content: [
            { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" },
          ],
        };
      }),
  );

  server.registerTool(
    "browser_close",
    {
      title: "Close the launched browser",
      description:
        "Stop the dedicated Chrome React Doctor launched as a fallback (the persistent instance reused across calls). Never touches a browser you started yourself. Use it to free that headless instance when done.",
      inputSchema: {},
      annotations: { openWorldHint: true },
    },
    () =>
      runTool(async () => {
        const closed = await closeLaunchedBrowser();
        return textResult(
          closed
            ? "Closed the launched browser."
            : "No launched browser to close (it only stops the one React Doctor launched).",
        );
      }),
  );
};
