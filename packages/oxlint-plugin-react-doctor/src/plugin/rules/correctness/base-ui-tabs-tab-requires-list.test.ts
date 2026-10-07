import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { baseUiTabsTabRequiresList } from "./base-ui-tabs-tab-requires-list.js";

describe("base-ui-tabs-tab-requires-list", () => {
  it("reports a tab directly inside Tabs.Root without a list", () => {
    const result = runRule(
      baseUiTabsTabRequiresList,
      `import { Tabs } from "@base-ui/react/tabs";
       const View = () => (
         <Tabs.Root defaultValue="overview">
           <Tabs.Tab value="overview">Overview</Tabs.Tab>
           <Tabs.Panel value="overview">Stats</Tabs.Panel>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports the pre-1.0 package name and renamed namespaces", () => {
    const result = runRule(
      baseUiTabsTabRequiresList,
      `import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
       const View = () => (
         <BaseTabs.Root><div><BaseTabs.Tab value="a">A</BaseTabs.Tab></div></BaseTabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows tabs nested inside the list", () => {
    const result = runRule(
      baseUiTabsTabRequiresList,
      `import { Tabs } from "@base-ui/react/tabs";
       const View = () => (
         <Tabs.Root>
           <Tabs.List><Tabs.Tab value="a">A</Tabs.Tab><Tabs.Indicator /></Tabs.List>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for extracted tabs, unresolved wrappers, and other libraries", () => {
    const result = runRule(
      baseUiTabsTabRequiresList,
      `import { Tabs } from "@base-ui/react/tabs";
       import { Tabs as OtherTabs } from "another-tabs-kit";
       import { PillList } from "./pill-list";
       export const NavTab = ({ value }) => <Tabs.Tab value={value}>{value}</Tabs.Tab>;
       export const View = () => (
         <>
           <Tabs.Root><PillList><Tabs.Tab value="a">A</Tabs.Tab></PillList></Tabs.Root>
           <OtherTabs.Root><OtherTabs.Tab value="a">A</OtherTabs.Tab></OtherTabs.Root>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores JSX returned from a non-render callback attribute", () => {
    const result = runRule(
      baseUiTabsTabRequiresList,
      `import { Tabs } from "@base-ui/react/tabs";
       const View = () => (
         <Tabs.Root>
           <button onClick={() => <Tabs.Tab value="a">A</Tabs.Tab>}>Open</button>
         </Tabs.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
