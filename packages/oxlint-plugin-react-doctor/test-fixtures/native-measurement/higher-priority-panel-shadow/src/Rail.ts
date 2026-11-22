import { createElement } from "react";
export default function Rail({ wrapper, content, offset }: any) {
  return createElement(
    "div",
    {
      ref(node: HTMLDivElement | null) {
        wrapper.current = node;
        if (node) node.getBoundingClientRect = () => ({ width: offset, height: 8 }) as DOMRect;
      },
    },
    createElement("nav", { ref: content }, "Items"),
  );
}
