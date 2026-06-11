import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { postmessageOriginRisk } from "./postmessage-origin-risk.js";

describe("security-scan/postmessage-origin-risk — regressions", () => {
  it("flags a message listener that reads event.data without an origin check", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widget.ts",
      content: `window.addEventListener("message", (event) => {\n  handleCommand(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      "A message event handler reads cross-window messages without an obvious origin check.",
    );
    expect(findings[0]?.line).toBe(1);
    // No per-finding overrides: severity/title come from the rule metadata.
    expect(findings[0]?.severity).toBeUndefined();
    expect(findings[0]?.title).toBeUndefined();
  });

  it("stays silent when the handler validates event.origin before reading event.data", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widget.ts",
      content: `window.addEventListener("message", (event) => {\n  if (event.origin !== "https://trusted.example.com") return;\n  handleCommand(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when origin validation lives in a called helper", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widget.ts",
      content: `window.addEventListener("message", (event) => {\n  if (!isAllowedOrigin(event)) return;\n  handleCommand(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when the handler never reads event.data", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widget.ts",
      content: `window.addEventListener("message", () => {\n  refreshBadge();\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on MessagePort and worker channels", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widget.ts",
      content: `channel.port1.onmessage = (event) => {\n  handleCommand(event.data);\n};\nworker.addEventListener("message", (event) => {\n  applyResult(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on worker-global self.onmessage handlers", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/subset/subset-chunk.ts",
      content: `self.onmessage = async (e) => {\n  process(e.data.arrayBuffer);\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in worker-named files", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/fonts/subset-worker.chunk.ts",
      content: `globalThis.addEventListener("message", (event) => {\n  process(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on non-production source paths even with the vulnerable shape", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/__tests__/widget.test.ts",
      content: `window.addEventListener("message", (event) => {\n  handleCommand(event.data);\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on EventSource message handlers", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/dev-toolbar-context.tsx",
      content: `const eventSource = new EventSource(streamUrl);\neventSource.onmessage = (event) => {\n  appendEvent(JSON.parse(event.data));\n};\neventSource.addEventListener("message", (event) => {\n  appendEvent(JSON.parse(event.data));\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on WebSocket message handlers", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/editor/comments.tsx",
      content: `socket?.addEventListener("message", function (event) {\n  if (event.data === "threads") fetchData();\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("treats event.source comparisons as a sender check", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/widgets/custom-widget-script.ts",
      content: `window.addEventListener("message", (event) => {\n  if (event.source === window.parent) {\n    handlerList.forEach((handler) => handler(event.data));\n  }\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on camelCase BroadcastChannel receivers", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/auth-state.ts",
      content: `const tokenChannel = new BroadcastChannel("auth_token");\ntokenChannel.onmessage = (event) => {\n  applyToken(event.data.token);\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on server-sent-event sources named source", () => {
    const findings = runScanRule(postmessageOriginRisk, {
      relativePath: "src/context/event-stream-context.tsx",
      content: `const source = new EventSource("/api/events");\nsource.addEventListener("message", async (e) => {\n  dispatch(JSON.parse(e.data));\n});\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
