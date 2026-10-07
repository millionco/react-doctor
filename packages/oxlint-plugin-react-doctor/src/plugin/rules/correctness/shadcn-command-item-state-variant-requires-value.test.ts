import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnCommandItemStateVariantRequiresValue } from "./shadcn-command-item-state-variant-requires-value.js";

describe("shadcn-command-item-state-variant-requires-value", () => {
  it("reports a presence-only selected variant on a cmdk primitive item", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import { Command } from "cmdk";
       const Item = (props) => (
         <Command.Item className="data-[selected]:bg-accent data-[selected]:text-accent-foreground" {...props} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("data-[selected=true]:");
  });

  it("reports a presence-only disabled variant inside a cn() call", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import { CommandItem } from "cmdk";
       import { cn } from "@/lib/utils";
       const Item = ({ className, ...props }) => (
         <CommandItem className={cn("px-2 py-1.5 data-[disabled]:pointer-events-none", className)} {...props} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("data-[disabled=true]:");
  });

  it("reports items from the project's command module and namespace cmdk spellings", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import * as Cmdk from "cmdk";
       import { CommandItem } from "@/components/ui/command";
       const View = ({ extra }) => (
         <>
           <Cmdk.Command.Item className="data-[selected]:bg-red-500" />
           <CommandItem className={\`px-2 \${extra} data-[selected]:bg-accent\`}>Open</CommandItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts value-aware state variants", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import { CommandItem } from "cmdk";
       const Item = (props) => (
         <CommandItem
           className="data-[selected=true]:bg-accent data-[disabled=true]:opacity-50 data-[state=open]:flex"
           {...props}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores presence variants on non-item elements and other libraries", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import { CommandItem } from "another-palette";
       import { CommandItem as FeatureItem } from "@/features/search/command";
       const View = () => (
         <>
           <div className="data-[selected]:bg-accent" />
           <CommandItem className="data-[selected]:bg-accent" />
           <FeatureItem className="data-[selected]:bg-accent" />
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves bare named variants and unbracketed attributes alone", () => {
    const result = runRule(
      shadcnCommandItemStateVariantRequiresValue,
      `import { CommandItem } from "cmdk";
       const Item = (props) => (
         <CommandItem className="data-selected:bg-accent aria-selected:bg-accent" {...props} />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
