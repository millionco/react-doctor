import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserSession } from "@react-doctor/browser";
import { z } from "zod";
import { parseViewport } from "@react-doctor/browser";
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

const urlShape = {
  url: z
    .string()
    .optional()
    .describe("URL to load; omit to read the current page without reloading"),
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

interface PageToolDefinition {
  name: string;
  title: string;
  description: string;
  // Build the result inside the session scope (the session is disposed once
  // this resolves), against the optional `url` to load.
  run: (session: BrowserSession, url: string | undefined) => Promise<CallToolResult>;
}

// The read-only "load a page (or read the current one) and report" tools all
// share the same url + connection + viewport inputs and session lifecycle, so
// they register through this table rather than repeating the scaffolding.
const registerPageTool = (server: McpServer, definition: PageToolDefinition): void => {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: { ...urlShape, ...connectionShape, ...viewportShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(() =>
        withSession(toConnection(args), (session) => definition.run(session, args.url)),
      ),
  );
};

export const registerBrowserTools = (server: McpServer): void => {
  server.registerTool(
    "browser_open",
    {
      title: "Open a URL with the React profiler",
      description:
        "Open a URL in the attached Chrome and keep the page, injecting the React DevTools profiler so browser_eval can drive window.__REACT_PERF__ (start()/stop()) for render profiling. Attaches to your running Chrome over CDP, launching a dedicated one only as a fallback.",
      inputSchema: { url: z.string().describe("URL to open"), ...connectionShape },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        await withSession(toConnection(args), (session) => session.openWithReactProfiler(args.url));
        return textResult(
          `Opened ${args.url}. React profiler ready: call browser_eval with "page.evaluate(() => window.__REACT_PERF__.start())", drive a scenario, then stop() for the DevTools profiling export.`,
        );
      }),
  );

  server.registerTool(
    "browser_eval",
    {
      title: "Evaluate Playwright code on the page",
      description:
        'Run an async expression with the Playwright `page` in scope (e.g. page.locator("text=Login").click()) against the attached page. Use to drive the exact repro between opening a page and measuring it.',
      inputSchema: {
        expression: z.string().describe("Async expression with the Playwright `page` in scope"),
        ...connectionShape,
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const result = await withSession(toConnection(args), (session) =>
          session.evaluate(args.expression),
        );
        if (result === undefined) return textResult("(no value)");
        return textResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));
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

  registerPageTool(server, {
    name: "browser_audit",
    title: "Run an accessibility audit",
    description:
      "Run an axe-core accessibility audit on the attached page (or a URL; reloads the current page when no URL is given) and return the violations with impact, help text, and affected element targets.",
    run: async (session, url) => {
      const violations = await session.audit(url);
      return jsonResult({ violationCount: violations.length, violations });
    },
  });

  registerPageTool(server, {
    name: "browser_console",
    title: "Capture console output",
    description:
      "Capture console messages and page errors during a load of the attached page (or a URL; reloads when no URL is given).",
    run: async (session, url) => {
      const messages = await session.captureConsole(url);
      return jsonResult({ messageCount: messages.length, messages });
    },
  });

  registerPageTool(server, {
    name: "browser_network",
    title: "Capture network requests",
    description:
      "Capture network requests during a load of the attached page (or a URL; reloads when no URL is given), flagging failures and non-2xx/3xx responses.",
    run: async (session, url) => {
      const requests = await session.captureNetwork(url);
      return jsonResult({ requestCount: requests.length, requests });
    },
  });

  registerPageTool(server, {
    name: "browser_perf",
    title: "Measure runtime performance (jank)",
    description:
      "Capture long animation frames (>50ms main-thread jank) with per-script attribution, plus LCP and CLS. Loads a URL when given; omit the URL to measure the current page without reloading (so a browser_eval interaction's jank is included).",
    run: async (session, url) => jsonResult(await session.measurePerformance(url)),
  });

  registerPageTool(server, {
    name: "browser_report",
    title: "Capture a full page report",
    description:
      "Capture console, network, performance, and accessibility in a single load — the efficient path when you want the whole runtime picture at once. Always loads (a URL when given, otherwise reloads the current page); to measure after a browser_eval interaction without reloading, use browser_perf.",
    run: async (session, url) => jsonResult(await session.inspectPage(url)),
  });
};
