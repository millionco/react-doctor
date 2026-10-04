import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { RuntimeScanUrlPrompt } from "../../src/cli/ink/prompt-runtime-scan-url.js";

const ENTER = "\r";
const ESCAPE = "\u001b";
const DOWN_ARROW = "\u001b[B";
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const discoverNoLocalUrls = async () => [];

describe("RuntimeScanUrlPrompt", () => {
  it("centers the chooser in a full-terminal view", async () => {
    const { stdout, lastFrame, unmount } = render(
      <RuntimeScanUrlPrompt discoverLocalUrls={discoverNoLocalUrls} onSubmit={vi.fn()} />,
    );
    Object.defineProperty(stdout, "columns", { configurable: true, get: () => 100 });
    Object.defineProperty(stdout, "rows", { configurable: true, get: () => 20 });
    stdout.emit("resize");
    await flush();

    const renderedLines = lastFrame()?.split("\n") ?? [];
    const headerRow = renderedLines.findIndex((line) => line.includes("React Doctor"));
    expect(renderedLines).toHaveLength(20);
    expect(headerRow).toBeGreaterThan(0);
    expect(headerRow).toBeLessThan(19);
    unmount();
  });

  it("offers detected local apps before custom entry", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <RuntimeScanUrlPrompt
        discoverLocalUrls={async () => [
          {
            port: 3_000,
            url: "http://localhost:3000",
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    await flush();

    expect(lastFrame()).toContain("Choose an app to scan");
    expect(lastFrame()).toContain("http://localhost:3000 detected");
    expect(lastFrame()).toContain("Enter another URL");

    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith("http://localhost:3000");
    unmount();
  });

  it("submits an absolute HTTP URL", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RuntimeScanUrlPrompt discoverLocalUrls={discoverNoLocalUrls} onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("http://localhost:3000/dashboard?view=slow");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith("http://localhost:3000/dashboard?view=slow");
    unmount();
  });

  it("keeps prompting after an invalid URL", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <RuntimeScanUrlPrompt discoverLocalUrls={discoverNoLocalUrls} onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("localhost:3000");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("Enter an absolute URL starting with http:// or https://.");
    unmount();
  });

  it("cancels on Escape", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RuntimeScanUrlPrompt discoverLocalUrls={discoverNoLocalUrls} onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write(ESCAPE);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(null);
    unmount();
  });

  it("opens custom entry after detected suggestions", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <RuntimeScanUrlPrompt
        discoverLocalUrls={async () => [
          {
            port: 5_173,
            url: "http://localhost:5173",
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    await flush();

    stdin.write(DOWN_ARROW);
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(lastFrame()).toContain("App URL");
    stdin.write("https://app.example.com");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith("https://app.example.com");
    unmount();
  });
});
