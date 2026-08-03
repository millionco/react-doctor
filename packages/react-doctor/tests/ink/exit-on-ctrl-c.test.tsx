import { Text } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CANONICAL_GITHUB_URL, DOCS_URL } from "@react-doctor/core";
import { useExitOnCtrlC } from "../../src/cli/ink/hooks/use-exit-on-ctrl-c.js";
import { registerActiveTuiRenderer } from "../../src/cli/utils/active-tui-renderer.js";

const Harness = () => {
  useExitOnCtrlC();
  return <Text>ready</Text>;
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe("useExitOnCtrlC", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("force-exits with code 130 on Ctrl+C", async () => {
    const lifecycleEvents: string[] = [];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      lifecycleEvents.push("log");
    });
    registerActiveTuiRenderer({
      clear: () => lifecycleEvents.push("clear"),
    });

    const { stdin, unmount } = render(<Harness />);
    await flush();

    stdin.write("\u0003");
    await flush();

    expect(exitSpy).toHaveBeenCalledWith(130);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(DOCS_URL));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(CANONICAL_GITHUB_URL));
    expect(lifecycleEvents.slice(0, 2)).toEqual(["clear", "log"]);
    unmount();
  });

  it("ignores other keys", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const { stdin, unmount } = render(<Harness />);
    await flush();

    stdin.write("j");
    await flush();

    expect(exitSpy).not.toHaveBeenCalled();
    unmount();
  });
});
