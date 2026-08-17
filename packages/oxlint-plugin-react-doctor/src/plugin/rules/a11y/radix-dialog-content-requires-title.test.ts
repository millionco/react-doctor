import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { radixDialogContentRequiresTitle } from "./radix-dialog-content-requires-title.js";

describe("radix-dialog-content-requires-title", () => {
  it("reports namespace-imported primitive content without a title", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import * as Dialog from "@radix-ui/react-dialog";
       const View = () => (
         <Dialog.Root>
           <Dialog.Portal>
             <Dialog.Overlay />
             <Dialog.Content>
               <p>Are you sure?</p>
               <Dialog.Close>Close</Dialog.Close>
             </Dialog.Content>
           </Dialog.Portal>
         </Dialog.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Dialog.Title");
  });

  it("reports unified-package dialogs and alert dialogs, including renamed imports", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import { Dialog, AlertDialog as Alert } from "radix-ui";
       const View = () => (
         <>
           <Dialog.Content><p>Body</p></Dialog.Content>
           <Alert.Content><Alert.Description>Careful.</Alert.Description></Alert.Content>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports named part imports from the per-primitive package", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import { Content, Description } from "@radix-ui/react-alert-dialog";
       const View = () => <Content><Description>Careful.</Description></Content>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts titles, including through VisuallyHidden and renamed parts", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import * as Dialog from "@radix-ui/react-dialog";
       import { Title as SheetHeading } from "@radix-ui/react-dialog";
       import { VisuallyHidden } from "radix-ui";
       const View = () => (
         <>
           <Dialog.Content><Dialog.Title>Delete file</Dialog.Title></Dialog.Content>
           <Dialog.Content><VisuallyHidden.Root><Dialog.Title>Search</Dialog.Title></VisuallyHidden.Root></Dialog.Content>
           <Dialog.Content><SheetHeading>Filters</SheetHeading></Dialog.Content>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the content is named, spread, or not statically enumerable", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import * as Dialog from "@radix-ui/react-dialog";
       const Wrapper = ({ children, ...props }) => (
         <>
           <Dialog.Content aria-label="Settings"><p>Body</p></Dialog.Content>
           <Dialog.Content {...props}><p>Body</p></Dialog.Content>
           <Dialog.Content>{children}</Dialog.Content>
           <Dialog.Content><ConfirmHeader /><p>Body</p></Dialog.Content>
         </>
       );
       const ConfirmHeader = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips other-library namespaces and local components", () => {
    const result = runRule(
      radixDialogContentRequiresTitle,
      `import * as Dialog from "another-dialog-kit";
       import { Popover } from "radix-ui";
       const View = () => (
         <>
           <Dialog.Content><p>Body</p></Dialog.Content>
           <Popover.Content><p>Body</p></Popover.Content>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
