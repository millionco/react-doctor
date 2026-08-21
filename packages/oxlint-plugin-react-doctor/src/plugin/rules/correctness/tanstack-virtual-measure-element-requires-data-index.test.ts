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
       const List = ({ parentRef }) => {
         const virtualizer = useVirtualizer({
           count: 10,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
         });
         const { measureElement } = virtualizer;
         const measure = virtualizer.measureElement;
         return (
           <>
             <li ref={measureElement}>Row</li>
             <li ref={(node) => virtualizer.measureElement(node)}>Row</li>
             <li ref={(node) => { virtualizer.measureElement(node); }}>Row</li>
             <li ref={measure}>Row</li>
             <li ref={virtualizer["measureElement"]}>Row</li>
           </>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("accepts measured elements carrying data-index", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ parentRef, virtualItem }) => {
         const virtualizer = useVirtualizer({
           count: 10,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
         });
         return (
           <div ref={virtualizer.measureElement} data-index={virtualItem.index}>
             Row
           </div>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("checks the index attribute configured by each virtualizer", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       const List = ({ itemProps, items, parentRef }) => {
         const customVirtualizer = useVirtualizer({
           count: items.length,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
           indexAttribute: "data-row-index",
         });
         const defaultVirtualizer = useVirtualizer({
           count: items.length,
           getScrollElement: () => parentRef.current,
           estimateSize: () => 40,
         });
         return (
           <>
             <div ref={customVirtualizer.measureElement} data-row-index={0}>Row</div>
             <div ref={customVirtualizer.measureElement}>Row</div>
             <div ref={defaultVirtualizer.measureElement}>Row</div>
             <div ref={defaultVirtualizer.measureElement} {...itemProps}>Row</div>
           </>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("data-row-index"),
      expect.stringContaining("data-index"),
    ]);
  });

  it("ignores unrelated measureElement refs even when the virtualizer is imported", () => {
    const result = runRule(
      tanstackVirtualMeasureElementRequiresDataIndex,
      `import { useVirtualizer } from "@tanstack/react-virtual";
       import type { Virtualizer } from "@tanstack/react-virtual";
       const measureElement = (node) => node?.getBoundingClientRect();
       const resizeObserver = { measureElement };
       const View = () => (
         <>
           <div ref={measureElement}>Row</div>
           <div ref={resizeObserver.measureElement}>Row</div>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
