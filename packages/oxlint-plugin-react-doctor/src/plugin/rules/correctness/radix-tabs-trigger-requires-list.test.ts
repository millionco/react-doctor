import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { radixTabsTriggerRequiresList } from "./radix-tabs-trigger-requires-list.js";

describe("radix-tabs-trigger-requires-list", () => {
  it("reports a trigger directly inside Tabs.Root without a list", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import * as Tabs from "@radix-ui/react-tabs";
       const View = () => (
         <Tabs.Root defaultValue="a">
           <Tabs.Trigger value="a">A</Tabs.Trigger>
           <Tabs.Content value="a">Content</Tabs.Content>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports unified-package and named-part import spellings", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import { Tabs } from "radix-ui";
       import { Root, Trigger } from "@radix-ui/react-tabs";
       const View = () => (
         <>
           <Tabs.Root><div><Tabs.Trigger value="a">A</Tabs.Trigger></div></Tabs.Root>
           <Root><Trigger value="b">B</Trigger></Root>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows triggers nested inside the list", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import * as Tabs from "@radix-ui/react-tabs";
       const View = () => (
         <Tabs.Root>
           <Tabs.List><Tabs.Trigger value="a">A</Tabs.Trigger></Tabs.List>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for extracted triggers and unresolved wrappers", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import * as Tabs from "@radix-ui/react-tabs";
       import { SegmentedList } from "./segmented-list";
       export const NavTrigger = ({ value }) => <Tabs.Trigger value={value}>{value}</Tabs.Trigger>;
       export const View = () => (
         <Tabs.Root><SegmentedList><Tabs.Trigger value="a">A</Tabs.Trigger></SegmentedList></Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips other-library tabs", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import * as Tabs from "another-tabs-kit";
       const View = () => <Tabs.Root><Tabs.Trigger value="a">A</Tabs.Trigger></Tabs.Root>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores JSX returned from a non-render callback attribute", () => {
    const result = runRule(
      radixTabsTriggerRequiresList,
      `import * as Tabs from "@radix-ui/react-tabs";
       const View = () => (
         <Tabs.Root>
           <button onClick={() => <Tabs.Trigger value="a">A</Tabs.Trigger>}>Open</button>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
