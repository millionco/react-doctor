import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackVirtualMeasureElementRequiresDataIndex } from "./tanstack-virtual-measure-element-requires-data-index.js";

describe("tanstack-virtual-measure-element-requires-data-index", () => {
  it("reports a measured element without data-index", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ parentRef, items }) => {
         const virtualizer = useVirtualizer({
           count: items.length,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
         });
         return (
           <div ref={parentRef}>
             {virtualizer.getVirtualItems().map((virtualItem) => (
               <div key={virtualItem.key} ref={virtualizer.measureElement}>
                 {items[virtualItem.index]}
               </div>
             ))}
           </div>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("data-index");
  });

  it("reports destructured and callback ref forms", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ virtualizer }) => {
         const { measureElement } = virtualizer;
         return (
           <>
             <li ref={measureElement}>Row</li>
             <li ref={(node) => virtualizer.measureElement(node)}>Row</li>
           </>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts measured elements carrying data-index", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ virtualizer, virtualItem }) => (
         <div ref={virtualizer.measureElement} data-index={virtualItem.index}>
           Row
         </div>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for spreads and custom indexAttribute configurations", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ virtualizer, itemProps, items, parentRef }) => {
         const windowVirtualizer = useVirtualizer({
           count: items.length,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
           indexAttribute: "data-row-index",
         });
         return (
           <>
             <div ref={virtualizer.measureElement} {...itemProps}>Row</div>
             <div ref={windowVirtualizer.measureElement} data-row-index={0}>Row</div>
           </>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores measureElement refs in files that never import the virtualizer", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `const measureElement = (node) => node?.getBoundingClientRect();
       const View = () => <div ref={measureElement}>Row</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
