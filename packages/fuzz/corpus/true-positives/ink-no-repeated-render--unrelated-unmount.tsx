// rule: ink-no-repeated-render
// weakness: binding-identity
// source: unrelated cleanup does not release Ink's renderer
import { render } from "ink";

interface OtherRenderer {
  unmount: () => void;
}

export const mountTwice = (otherRenderer: OtherRenderer) => {
  render(null);
  otherRenderer.unmount();
  render(null);
};
