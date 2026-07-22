import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import type { WorkspacePackage } from "@react-doctor/core";
import { ProjectSelect } from "../../src/cli/ink/components/project-select.js";

const PACKAGES: WorkspacePackage[] = [
  { name: "web", directory: "/repo/apps/web" },
  { name: "docs", directory: "/repo/apps/docs" },
];

// ink-testing-library needs a tick for effects (useInput wiring) to flush.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

const DOWN_ARROW = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";

describe("ProjectSelect", () => {
  it("scans only the highlighted project when Enter is pressed with nothing checked", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web"]);
    unmount();
  });

  it("scans the whole workspace after select-all", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("a");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web", "/repo/apps/docs"]);
    unmount();
  });

  it("preserves the selection when select-all has no matching projects", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("a");
    await flush();
    stdin.write("/");
    await flush();
    stdin.write("missing");
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write("a");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web", "/repo/apps/docs"]);
    unmount();
  });

  it("adds filtered matches without dropping hidden selections", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write(" ");
    await flush();
    stdin.write("/");
    await flush();
    stdin.write("docs");
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write("a");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web", "/repo/apps/docs"]);
    unmount();
  });

  it("clears filtered matches without dropping hidden selections", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("a");
    await flush();
    stdin.write("/");
    await flush();
    stdin.write("docs");
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write("a");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web"]);
    unmount();
  });

  it("scans the subset built with space", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write(DOWN_ARROW);
    await flush();
    stdin.write(" ");
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/docs"]);
    unmount();
  });

  it("does not filter until search mode is entered with '/'", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    // Outside search mode, letters are commands — typing "doc" doesn't filter.
    stdin.write("doc");
    await flush();
    expect(lastFrame()).toContain("web");
    expect(lastFrame()).toContain("docs");

    // Enter search, filter to "doc", confirm, then scan the surviving match.
    stdin.write("/");
    await flush();
    stdin.write("doc");
    await flush();
    expect(lastFrame()).toContain("docs");
    expect(lastFrame()).not.toContain("web");

    stdin.write(ENTER);
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/docs"]);
    unmount();
  });

  it("clears the selection on Esc before cancelling", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    stdin.write("a");
    await flush();
    expect(lastFrame()).toContain("2/2");

    // First Esc clears the selection (no cancel yet)...
    stdin.write(ESC);
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("0/2");

    // ...a second Esc cancels.
    stdin.write(ESC);
    await flush();
    expect(onSubmit).toHaveBeenCalledWith([]);
    unmount();
  });

  it("keeps the list and hint inside a small terminal", async () => {
    const onSubmit = vi.fn();
    const packages = [
      ...PACKAGES,
      { name: "admin", directory: "/repo/apps/admin" },
      { name: "api", directory: "/repo/apps/api" },
    ];
    const { stdout, lastFrame, unmount } = render(
      <ProjectSelect packages={packages} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    Object.defineProperty(stdout, "rows", { get: () => 5, configurable: true });
    stdout.emit("resize");
    await flush();

    expect(lastFrame()?.split("\n")).toHaveLength(5);
    unmount();
  });
});
