// rule: ink-no-repeated-render
// weakness: library-idiom
// source: Ink render docs permit separate instances on different stdout streams
import { render } from "ink";

export const mountBoth = (firstOutput: NodeJS.WriteStream, secondOutput: NodeJS.WriteStream) => {
  render(null, { stdout: firstOutput });
  render(null, { stdout: secondOutput });
};

export const mountShadowed = (
  firstOutput: NodeJS.WriteStream,
  secondOutput: NodeJS.WriteStream,
) => {
  {
    const output = firstOutput;
    render(null, { stdout: output });
  }
  {
    const output = secondOutput;
    render(null, { stdout: output });
  }
};
