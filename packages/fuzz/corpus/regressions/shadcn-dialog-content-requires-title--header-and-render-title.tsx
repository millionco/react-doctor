// rule: shadcn-dialog-content-requires-title
// verdict: pass
// weakness: wrapper-transparency
// source: /tmp/ui-corpus hunt (Intent UI drawer header titles; shadcn v4 questionnaire render-prop titles)
import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DrawerBody, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { QuestionnaireItem, QuestionnaireTitle } from "@/components/ui/questionnaire";

export const StickyDrawer = () => (
  <DrawerContent>
    <DrawerHeader>The Beatles</DrawerHeader>
    <DrawerBody>
      <p>Terms of use.</p>
    </DrawerBody>
  </DrawerContent>
);

export const QuestionnaireDialog = () => (
  <DialogContent>
    <QuestionnaireItem name="scope" required>
      <QuestionnaireTitle render={<DialogTitle />}>Which files are in scope?</QuestionnaireTitle>
    </QuestionnaireItem>
  </DialogContent>
);
