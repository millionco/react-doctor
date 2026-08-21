import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactAriaDialogRequiresHeading } from "./react-aria-dialog-requires-heading.js";

describe("react-aria-dialog-requires-heading", () => {
  it("uses the DialogTrigger label fallback but reports an unnamed standalone dialog", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { DialogTrigger, Modal, Dialog, Button } from "react-aria-components";
       const View = () => (
         <>
           <DialogTrigger>
             <Button>Delete…</Button>
             <Modal>
               <Dialog>
                 <p>This file will be permanently deleted.</p>
                 <Button slot="close">Cancel</Button>
               </Dialog>
             </Modal>
           </DialogTrigger>
           <Dialog><p>Standalone body</p></Dialog>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Heading");
  });

  it("supports renamed and namespace imports", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { Dialog as AriaDialog } from "react-aria-components";
       import * as Aria from "react-aria-components";
       const View = () => (
         <>
           <AriaDialog><p>Body</p></AriaDialog>
           <Aria.Dialog><p>Body</p></Aria.Dialog>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts a heading, including inside a render-prop child", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { Dialog, Heading, Button } from "react-aria-components";
       const View = () => (
         <>
           <Dialog>
             <Heading slot="title">Delete file</Heading>
           </Dialog>
           <Dialog>
             {({ close }) => (
               <>
                 <Heading slot="title">Delete file</Heading>
                 <Button onPress={close}>Cancel</Button>
               </>
             )}
           </Dialog>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires imported headings to use the title slot", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { Dialog, Heading } from "react-aria-components";
       const View = () => (
         <>
           <Dialog><Heading>Missing slot</Heading></Dialog>
           <Dialog><Heading slot="description">Wrong slot</Heading></Dialog>
           <Dialog><Heading slot={null}>Null slot</Heading></Dialog>
           <Dialog><Heading slot={dynamicSlot}>Dynamic slot</Heading></Dialog>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("stays quiet when the dialog is named, spread, or not statically enumerable", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { Dialog } from "react-aria-components";
       const Wrapper = ({ children, ...props }) => (
         <>
           <Dialog aria-label="Settings"><p>Body</p></Dialog>
           <Dialog {...props}><p>Body</p></Dialog>
           <Dialog>{children}</Dialog>
           <Dialog><ConfirmHeader /><p>Body</p></Dialog>
           <Dialog>{({ close }) => <BodyContent onClose={close} />}</Dialog>
         </>
       );
       const ConfirmHeader = () => null;
       const BodyContent = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dialogs from other libraries and local components", () => {
    const result = runRule(
      reactAriaDialogRequiresHeading,
      `import { Dialog } from "another-aria-kit";
       const LocalDialog = ({ children }) => <div role="dialog">{children}</div>;
       const View = () => (
         <>
           <Dialog><p>Body</p></Dialog>
           <LocalDialog><p>Body</p></LocalDialog>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
