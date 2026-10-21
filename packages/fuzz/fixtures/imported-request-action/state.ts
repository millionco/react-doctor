import { useCallback } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
const dialogState = atom({ open: false });
export const useDialogState = () => useAtomValue(dialogState);
export const useDialogActions = () => {
  const update = useSetAtom(dialogState);
  const close = useCallback(() => {
    update({ open: false });
  }, [update]);
  return { close };
};
