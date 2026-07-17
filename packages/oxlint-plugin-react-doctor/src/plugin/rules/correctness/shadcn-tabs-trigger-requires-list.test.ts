import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnTabsTriggerRequiresList } from "./shadcn-tabs-trigger-requires-list.js";

describe("shadcn-tabs-trigger-requires-list", () => {
  it("reports a proven imported trigger outside the list", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { Tabs, TabsTrigger } from "@/components/ui/tabs"; const View = () => <Tabs><TabsTrigger value="a">A</TabsTrigger></Tabs>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports aliases and namespace imports", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { TabsTrigger as Trigger } from "./tabs"; import * as UI from "./components/tabs"; const View = () => <><Trigger value="a" /><UI.TabsTrigger value="b" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows triggers nested anywhere inside the imported list", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { TabsList, TabsTrigger } from "@/components/ui/tabs"; const View = () => <TabsList><div><TabsTrigger value="a">A</TabsTrigger></div></TabsList>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips local, unrelated, and type-only components", () => {
    const result = runRule(
      shadcnTabsTriggerRequiresList,
      `import { TabsTrigger } from "other-library"; import { type TabsTrigger as TriggerType } from "./tabs"; const LocalTrigger = () => null; const View = () => <><TabsTrigger /><TriggerType /><LocalTrigger /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
