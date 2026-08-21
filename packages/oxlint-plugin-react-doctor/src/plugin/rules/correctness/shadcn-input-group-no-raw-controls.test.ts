import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnInputGroupNoRawControls } from "./shadcn-input-group-no-raw-controls.js";

describe("shadcn-input-group-no-raw-controls", () => {
  it("reports a ui Input directly inside InputGroup", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
       import { Input } from "@/components/ui/input";
       const View = () => (
         <InputGroup>
           <Input placeholder="Search" />
           <InputGroupAddon align="inline-end">⌘K</InputGroupAddon>
         </InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("InputGroupInput");
  });

  it("reports native controls and ui Buttons, one diagnostic per control", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import { InputGroup, InputGroupAddon } from "./input-group";
       import { Button } from "@/components/ui/button";
       const View = () => (
         <InputGroup>
           <textarea rows={3} />
           <Button size="sm">Send</Button>
           <InputGroupAddon align="inline-end">Actions</InputGroupAddon>
         </InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("follows fragments, conditionals, and renamed or namespace imports", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import * as Group from "@/components/ui/input-group";
       import { Input as TextInput } from "~/ui/input";
       const View = ({ isEditable }) => (
         <Group.InputGroup>
           <>{isEditable && <TextInput />}</>
           <Group.InputGroupAddon align="inline-end">Edit</Group.InputGroupAddon>
         </Group.InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts the InputGroup part composition", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import {
         InputGroup,
         InputGroupAddon,
         InputGroupButton,
         InputGroupInput,
       } from "@/components/ui/input-group";
       const View = () => (
         <InputGroup>
           <InputGroupInput placeholder="Search" />
           <InputGroupAddon align="inline-end">
             <InputGroupButton>Go</InputGroupButton>
           </InputGroupAddon>
         </InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores controls nested below another element and hidden inputs", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
       import { Button } from "@/components/ui/button";
       const View = () => (
         <InputGroup>
           <InputGroupAddon><Button size="icon-xs">Go</Button></InputGroupAddon>
           <input type="hidden" name="token" value="abc" />
         </InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips custom or legacy groups without canonical InputGroup parts", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import { InputGroup } from "@/components/ui/input-group";
       import { Input } from "@/components/ui/input";
       import { Textarea } from "@/components/ui/textarea";
       import { Button } from "@/components/ui/button";
       const View = () => (
         <InputGroup>
           <Input />
           <Textarea />
           <Button>Send</Button>
         </InputGroup>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips other-library groups and controls and unknown components", () => {
    const result = runRule(
      shadcnInputGroupNoRawControls,
      `import { InputGroup } from "antd";
       import { Input } from "antd";
       import { InputGroup as FeatureInputGroup } from "@/features/search/input-group";
       import { Input as FeatureInput } from "@/features/search/input";
       import { InputGroup as UiInputGroup } from "@/components/ui/input-group";
       const View = () => (
         <>
           <InputGroup><Input /></InputGroup>
           <FeatureInputGroup><FeatureInput /></FeatureInputGroup>
           <UiInputGroup><SearchField /></UiInputGroup>
         </>
       );
       const SearchField = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
