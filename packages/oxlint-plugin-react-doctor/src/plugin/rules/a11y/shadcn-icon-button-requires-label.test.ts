import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnIconButtonRequiresLabel } from "./shadcn-icon-button-requires-label.js";

describe("shadcn-icon-button-requires-label", () => {
  it("reports an icon-only Button holding a lucide icon and no name", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       import { Trash2 } from "lucide-react";
       const View = () => (
         <Button variant="ghost" size="icon" onClick={remove}>
           <Trash2 className="size-4" />
         </Button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("aria-label");
  });

  it("supports nested component-library layouts below the ui directory", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button as DefaultButton } from "@/components/ui/shadcn-default/button";
       import { Button as PrimitiveButton } from "~/ui/primitives/button";
       const View = () => (
         <>
           <DefaultButton size="icon"><svg /></DefaultButton>
           <PrimitiveButton size="icon"><svg /></PrimitiveButton>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports every icon size variant, name-pattern icons, and inline svg", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "./button";
       import { GearIcon } from "@radix-ui/react-icons";
       const View = () => (
         <>
           <Button size="icon-sm"><GearIcon /></Button>
           <Button size="icon-lg"><svg viewBox="0 0 16 16"><path d="M0 0h16v16z" /></svg></Button>
           <Button size={compact ? "icon-xs" : "icon"}><ChevronDownIcon /></Button>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts aria-label, sr-only text, svg titles, and aria-labelledby", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       import { X, Copy } from "lucide-react";
       const View = () => (
         <>
           <Button size="icon" aria-label="Close"><X /></Button>
           <Button size="icon"><Copy /><span className="sr-only">Copy link</span></Button>
           <Button size="icon"><svg><title>Download</title><path d="M0 0" /></svg></Button>
           <Button size="icon" aria-labelledby="copy-heading"><Copy /></Button>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for dynamic or delegated content it cannot prove", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       const View = ({ icon, label }) => (
         <>
           <Button size="icon">{icon}</Button>
           <Button size="icon"><ActionGlyph label={label} /></Button>
           <Button size="icon" {...props} />
           <Button size="icon" asChild><a href="/settings" aria-label="Settings" /></Button>
           <Button size={buttonSize}><TrashIcon /></Button>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores text buttons and Buttons from other libraries", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       import { Button as AntButton } from "antd";
       import { Button as AcmeButton } from "@acme/button";
       import { Plus } from "lucide-react";
       const View = () => (
         <>
           <Button size="sm"><Plus />Add item</Button>
           <Button><Plus /></Button>
           <AntButton size="icon"><Plus /></AntButton>
           <AcmeButton size="icon"><Plus /></AcmeButton>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for buttons composed through render props", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
       import { Sun } from "lucide-react";
       const View = () => (
         <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
           <Sun />
           <span className="sr-only">Toggle theme</span>
         </DropdownMenuTrigger>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for react-aria slotted buttons whose context names them", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/registry/bases/aria/ui/button";
       import { X } from "lucide-react";
       const Chip = () => (
         <Button slot="remove" variant="ghost" size="icon-xs">
           <X />
         </Button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses rendered hidden state and non-empty naming evidence", () => {
    const result = runRule(
      shadcnIconButtonRequiresLabel,
      `import { Button } from "@/components/ui/button";
       const View = () => (
         <>
           <Button size="icon"><span aria-hidden>×</span></Button>
           <Button size="icon"><span hidden>Close</span></Button>
           <Button size="icon" asChild={false}><svg /></Button>
           <Button size="icon" slot="toolbar"><svg /></Button>
           <Button size="icon" aria-label=""><svg /></Button>
           <Button size="icon"><img src="/close.svg" alt="" /></Button>
           <Button size="icon"><span aria-hidden={false}>Close</span></Button>
           <Button size="icon"><img src="/close.svg" alt="Close" /></Button>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(6);
  });
});
