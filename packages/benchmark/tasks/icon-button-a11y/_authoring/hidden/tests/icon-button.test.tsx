import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "../src/icon-button.tsx";

const render = () =>
  renderToStaticMarkup(<IconButton label="Close" glyph={"\u00d7"} onPress={() => {}} />);

test("renders a control with the accessible name", () => {
  const html = render();
  expect(html).toContain('aria-label="Close"');
});

test("displays the glyph", () => {
  expect(render()).toContain("\u00d7");
});
