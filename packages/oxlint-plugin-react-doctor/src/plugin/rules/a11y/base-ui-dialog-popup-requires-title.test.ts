import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { baseUiDialogPopupRequiresTitle } from "./base-ui-dialog-popup-requires-title.js";

describe("base-ui-dialog-popup-requires-title", () => {
  it("reports a popup composed without a title", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog } from "@base-ui/react/dialog";
       const View = () => (
         <Dialog.Root>
           <Dialog.Portal>
             <Dialog.Backdrop />
             <Dialog.Popup>
               <p>Are you sure?</p>
               <Dialog.Close>Close</Dialog.Close>
             </Dialog.Popup>
           </Dialog.Portal>
         </Dialog.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Dialog.Title");
  });

  it("reports the pre-1.0 package name, root-module imports, and alert dialogs", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog } from "@base-ui-components/react/dialog";
       import { AlertDialog } from "@base-ui/react";
       const View = () => (
         <>
           <Dialog.Popup><p>Body</p></Dialog.Popup>
           <AlertDialog.Popup><AlertDialog.Description>Careful.</AlertDialog.Description></AlertDialog.Popup>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts a title part, renamed namespaces, and title name-alikes", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog as BaseDialog } from "@base-ui/react/dialog";
       const DialogTitle = ({ children }) => <h2>{children}</h2>;
       const View = () => (
         <>
           <BaseDialog.Popup><BaseDialog.Title>Delete file</BaseDialog.Title></BaseDialog.Popup>
           <BaseDialog.Popup><DialogTitle>Filters</DialogTitle></BaseDialog.Popup>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the popup is named, spread, rendered elsewhere, or dynamic", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog } from "@base-ui/react/dialog";
       const Wrapper = ({ children, ...props }) => (
         <>
           <Dialog.Popup aria-label="Settings"><p>Body</p></Dialog.Popup>
           <Dialog.Popup {...props}><p>Body</p></Dialog.Popup>
           <Dialog.Popup render={<section aria-label="Settings" />}><p>Body</p></Dialog.Popup>
           <Dialog.Popup>{children}</Dialog.Popup>
           <Dialog.Popup><ConfirmHeader /><p>Body</p></Dialog.Popup>
         </>
       );
       const ConfirmHeader = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a statically unnamed render target as naming evidence", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog } from "@base-ui/react/dialog";
       const View = () => (
         <>
           <Dialog.Popup render={<section />}><p>Body</p></Dialog.Popup>
           <Dialog.Popup render={(props) => <section {...props} />}><p>Body</p></Dialog.Popup>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips other-library namespaces and other Base UI components", () => {
    const result = runRule(
      baseUiDialogPopupRequiresTitle,
      `import { Dialog } from "some-dialog-kit";
       import { Popover } from "@base-ui/react/popover";
       const View = () => (
         <>
           <Dialog.Popup><p>Body</p></Dialog.Popup>
           <Popover.Popup><p>Body</p></Popover.Popup>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
