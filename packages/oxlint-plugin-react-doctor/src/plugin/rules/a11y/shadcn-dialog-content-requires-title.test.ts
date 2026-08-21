import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnDialogContentRequiresTitle } from "./shadcn-dialog-content-requires-title.js";

describe("shadcn-dialog-content-requires-title", () => {
  it("reports dialog content composed of intrinsic elements without a title", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { Dialog, DialogContent } from "@/components/ui/dialog";
       const View = () => (
         <Dialog>
           <DialogContent>
             <p>Are you sure?</p>
             <button type="button">Confirm</button>
           </DialogContent>
         </Dialog>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("DialogTitle");
  });

  it("reports sheet, alert-dialog, and drawer content without their titles", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { SheetContent } from "./sheet";
       import { AlertDialogContent, AlertDialogDescription } from "~/ui/alert-dialog";
       import { DrawerContent } from "@/components/ui/drawer";
       const View = () => (
         <>
           <SheetContent><nav><a href="/">Home</a></nav></SheetContent>
           <AlertDialogContent>
             <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
           </AlertDialogContent>
           <DrawerContent><p>Pick a date</p></DrawerContent>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts a drawer with its title part", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
       const View = () => (
         <DrawerContent>
           <DrawerHeader><DrawerTitle>Pick a date</DrawerTitle></DrawerHeader>
         </DrawerContent>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports content whose only components are same-module parts and ui-module leaves", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent, DialogDescription, DialogFooter } from "@/components/ui/dialog";
       import { Button } from "@/components/ui/button";
       const View = () => (
         <DialogContent>
           <DialogDescription>This cannot be undone.</DialogDescription>
           <DialogFooter>
             <Button variant="destructive">Delete</Button>
           </DialogFooter>
         </DialogContent>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a same-module header with content may supply the title", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DrawerContent, DrawerHeader, DrawerBody } from "@/components/ui/drawer";
       const View = () => (
         <DrawerContent>
           <DrawerHeader>The Beatles</DrawerHeader>
           <DrawerBody><p>Terms of use.</p></DrawerBody>
         </DrawerContent>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat the canonical DialogHeader layout as a title", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent, DialogHeader } from "@/components/ui/dialog";
       const View = () => (
         <DialogContent>
           <DialogHeader>Delete file?</DialogHeader>
         </DialogContent>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a title supplied through a render prop", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent, DialogTitle } from "@/components/ui/dialog";
       import { QuestionnaireTitle } from "@/components/ui/questionnaire";
       const View = () => (
         <DialogContent>
           <QuestionnaireTitle render={<DialogTitle />}>
             Which files are in scope?
           </QuestionnaireTitle>
         </DialogContent>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports renamed and namespace imports and static conditional children", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent as Content } from "./dialog";
       import * as Sheet from "@/components/ui/sheet";
       const View = ({ isBusy }) => (
         <>
           <Content>{isBusy ? <p>Working</p> : <p>Idle</p>}</Content>
           <Sheet.SheetContent><div /></Sheet.SheetContent>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts a title part anywhere in the static subtree", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
       import { SheetContent, SheetTitle as Heading } from "./sheet";
       const View = () => (
         <>
           <DialogContent>
             <DialogHeader><DialogTitle>Delete file</DialogTitle></DialogHeader>
           </DialogContent>
           <SheetContent><Heading>Filters</Heading></SheetContent>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a title rendered through a wrapper, a map callback, or a name-alike component", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent, DialogTitle } from "@/components/ui/dialog";
       import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
       const View = ({ headings }) => (
         <>
           <DialogContent>
             <VisuallyHidden><DialogTitle>Search</DialogTitle></VisuallyHidden>
           </DialogContent>
           <DialogContent>{headings.map((heading) => <DialogTitle key={heading}>{heading}</DialogTitle>)}</DialogContent>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the content is named, spread, or not statically enumerable", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent } from "@/components/ui/dialog";
       const Wrapper = ({ children, ...props }) => (
         <>
           <DialogContent aria-label="Settings"><p>Body</p></DialogContent>
           <DialogContent {...props}><p>Body</p></DialogContent>
           <DialogContent>{children}</DialogContent>
           <DialogContent><ConfirmHeader /><p>Body</p></DialogContent>
           <DialogContent />
         </>
       );
       const ConfirmHeader = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips other-library, local, and type-only dialog components", () => {
    const result = runRule(
      shadcnDialogContentRequiresTitle,
      `import { DialogContent } from "some-modal-kit";
       import { DialogContent as AcmeDialogContent } from "@acme/dialog";
       const LocalDialogContent = ({ children }) => <div>{children}</div>;
       const View = () => (
         <>
           <DialogContent><p>Body</p></DialogContent>
           <AcmeDialogContent><p>Body</p></AcmeDialogContent>
           <LocalDialogContent><p>Body</p></LocalDialogContent>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
