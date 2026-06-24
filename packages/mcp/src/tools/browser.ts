import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_TRACE_FILENAME, formatEvalValue, parseViewport } from "@react-doctor/browser";
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
  viewport?: string;
}

const toConnection = (args: ConnectionArgs): BrowserToolConnection => ({
  cdp: args.cdp,
  noLaunch: args.noLaunch,
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
        'Run an async expression with the Playwright `page` in scope (e.g. page.getByText("Login").click()) against the attached page. Two modes: by default it returns the expression\'s value — use it to locate, read, or drive the page. Set profile:true to instead record and return the full runtime picture while the expression runs. Open the page first with browser_open for React render data.',
      inputSchema: {
        expression: z
          .string()
          .optional()
          .describe(
            "Async expression with the Playwright `page` in scope; omit together with profile:true to measure the live page idle",
          ),
        profile: z
          .boolean()
          .optional()
          .describe(
            "Set true to record and return the full runtime picture while the expression runs — console, network, performance (LoAF jank/LCP/CLS plus a `timeline` roll-up of forced style-recalc/layout/hit-test/paint cost from a DevTools trace), accessibility, the React render profile (slow commits, hot components, unnecessary re-renders), and a V8 CPU profile. Also writes the raw timeline trace to `out` (loadable in DevTools) and returns its path as `tracePath`. Omit for just the expression's return value.",
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
        const result = await withSession(toConnection(args), (session) =>
          session.evaluate(expression),
        );
        if (result === undefined) return textResult("(no value)");
        return textResult(formatEvalValue(result));
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
};
