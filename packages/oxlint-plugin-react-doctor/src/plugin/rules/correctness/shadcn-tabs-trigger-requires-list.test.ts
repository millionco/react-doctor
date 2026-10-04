import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnTabsTriggerRequiresList } from "./shadcn-tabs-trigger-requires-list.js";

describe("shadcn-tabs-trigger-requires-list", () => {
  it("reports a proven imported trigger directly inside Tabs without a list", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger } from "@/components/ui/tabs"; const View = () => <Tabs><TabsTrigger value="a">A</TabsTrigger></Tabs>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports aliases and namespace imports", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger as Trigger } from "./tabs"; import * as UI from "./components/tabs"; const View = () => <><Tabs><Trigger value="a" /></Tabs><UI.Tabs><UI.TabsTrigger value="b" /></UI.Tabs></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a trigger nested through intrinsic wrappers inside Tabs", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger } from "@/components/ui/tabs"; const View = () => <Tabs><div><TabsTrigger value="a">A</TabsTrigger></div></Tabs>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows triggers nested anywhere inside the imported list", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"; const View = () => <Tabs><TabsList><div><TabsTrigger value="a">A</TabsTrigger></div></TabsList></Tabs>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for extracted triggers whose Tabs root lives in the parent component", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { TabsTrigger } from "@/components/ui/tabs"; export const NavTrigger = ({ value, label }) => <TabsTrigger value={value}>{label}</TabsTrigger>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an unresolved wrapper sits between the trigger and Tabs", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger } from "@/components/ui/tabs"; import { SegmentedList } from "./segmented-list"; const View = () => <Tabs><SegmentedList><TabsTrigger value="a">A</TabsTrigger></SegmentedList></Tabs>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips local, unrelated, and type-only components", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs } from "./tabs"; import { Tabs as FeatureTabs, TabsTrigger as FeatureTrigger } from "@/features/search/tabs"; import { TabsTrigger } from "other-library"; import { type TabsTrigger as TriggerType } from "./tabs"; const LocalTrigger = () => null; const View = () => <><Tabs><TabsTrigger /><TriggerType /><LocalTrigger /></Tabs><FeatureTabs><FeatureTrigger /></FeatureTabs></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores JSX returned from a non-render callback attribute", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger } from "@/components/ui/tabs";
       const View = () => (
         <Tabs>
           <button onClick={() => <TabsTrigger value="a">A</TabsTrigger>}>Open</button>
         </Tabs>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
