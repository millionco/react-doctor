import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import { TuiLink } from "../../src/cli/ink/components/tui-link.js";

describe("TuiLink", () => {
  it("preserves readable link text when hyperlinks are unavailable", () => {
    const url = "https://react.doctor/docs/rules/example";
    const { lastFrame, unmount } = render(<TuiLink url={url}>Rule guide: {url}</TuiLink>);

    expect(lastFrame()).toBe(`Rule guide: ${url}`);
    unmount();
  });
});
