// rule: effect-observer-needs-disconnect
// weakness: control-flow
// source: Daytona parity PR #1402, Edil-ozi/edil-ozi

import { useEffect } from "react";

export const TableOfContents = ({ itemIds }: { itemIds: string[] }) => {
  useEffect(() => {
    const observer = new IntersectionObserver(() => {});
    itemIds.forEach((itemId) => {
      const element = document.getElementById(itemId);
      if (element) observer.observe(element);
    });
    return () => {
      itemIds.forEach((itemId) => {
        const element = document.getElementById(itemId);
        if (element) observer.unobserve(element);
      });
    };
  }, [itemIds]);

  return null;
};
