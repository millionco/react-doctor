// rule: ink-no-repeated-render
// weakness: library-idiom
// source: Ink render returns a destructurable unmount method
import { render } from "ink";

export const remount = () => {
  const { unmount } = render(null);
  unmount();
  render(null);
};
