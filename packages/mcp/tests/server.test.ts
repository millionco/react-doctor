import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vite-plus/test";
import { createMcpServer } from "../src/server.js";

const listToolNames = async (): Promise<string[]> => {
  const server = createMcpServer({ version: "0.0.0-test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
};

test("registers the doctor, browser, and debug tools", async () => {
  expect(await listToolNames()).toEqual([
    "browser_eval",
    "browser_open",
    "browser_screenshot",
    "browser_snapshot",
    "debug_clear_logs",
    "debug_read_logs",
    "debug_serve",
    "doctor_scan",
  ]);
});

test("each tool exposes a description and input schema", async () => {
  const server = createMcpServer({ version: "0.0.0-test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} inputSchema`).toBeTruthy();
    }
  } finally {
    await client.close();
    await server.close();
  }
});
