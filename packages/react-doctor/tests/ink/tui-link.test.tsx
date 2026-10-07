import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TuiLink } from "../../src/cli/ink/components/tui-link.js";

describe("TuiLink", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves readable link text when hyperlinks are unavailable", () => {
    const url = "https://react.doctor/docs/rules/example";
    const { lastFrame, unmount } = render(<TuiLink url={url}>Rule guide: {url}</TuiLink>);

    expect(lastFrame()).toBe(`Rule guide: ${url}`);
    unmount();
  });

  it("renders a terminal hyperlink when hyperlinks are available", () => {
    vi.stubEnv("FORCE_HYPERLINK", "1");
    const url = "https://react.doctor";
    const { lastFrame, unmount } = render(<TuiLink url={url}>React Doctor</TuiLink>);

    expect(lastFrame()).toContain(`]8;;${url}`);
    expect(lastFrame()).toContain("React Doctor");
    unmount();
  });
});
