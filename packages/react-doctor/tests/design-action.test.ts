import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/cli/commands/inspect.js", () => ({
  inspectAction: vi.fn(),
}));

import { designAction } from "../src/cli/commands/design.js";
import { inspectAction } from "../src/cli/commands/inspect.js";

describe("designAction", () => {
  it("reuses inspection with the focused design profile", async () => {
    await designAction("/tmp/project", { json: true });

    expect(inspectAction).toHaveBeenCalledWith(
      "/tmp/project",
      { design: true, json: true, lint: true },
      "design",
    );
  });

  it("preserves an explicit lint opt-out", async () => {
    await designAction("/tmp/project", { lint: false });

    expect(inspectAction).toHaveBeenCalledWith(
      "/tmp/project",
      { design: true, lint: false },
      "design",
    );
  });
});
