import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { localRpcNativeBridgeRisk } from "./local-rpc-native-bridge-risk.js";

describe("security-scan/local-rpc-native-bridge-risk — regressions", () => {
  it("stays silent on exact-hostname localhost checks (cal.com preview shape)", () => {
    const findings = runScanRule(localRpcNativeBridgeRisk, {
      relativePath: "src/preview.ts",
      content: `const url = new URL(window.location.href);\nif (url.hostname === "localhost") {\n  const allowed = trustedHosts.includes(url.hostname);\n  if (allowed) state.update({ previewMode: true });\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags a localhost WebSocket bridge that executes commands", () => {
    const findings = runScanRule(localRpcNativeBridgeRisk, {
      relativePath: "src/bridge.ts",
      content: `const socket = new WebSocket("ws://127.0.0.1:9001");\nsocket.onmessage = ({ data }) => {\n  exec(JSON.parse(data).command);\n};\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a loopback browser-test server process", () => {
    const findings = runScanRule(localRpcNativeBridgeRisk, {
      relativePath: "tools/shot.mjs",
      content: `const port = await freePort();\nconst origin = \`http://127.0.0.1:\${port}\`;\nconst server = spawn("node", ["tools/serve.mjs", String(port), "dist"]);\nawait waitForServer(origin);\nconst browser = await chromium.launch();\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags a localhost request handler that executes commands", () => {
    const findings = runScanRule(localRpcNativeBridgeRisk, {
      relativePath: "src/bridge.ts",
      content: `server.listen(9001, "localhost");\nserver.on("request", (req) => {\n  spawn(req.url.slice(1));\n});\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
