// rule: no-event-handler
// weakness: guarded-lifecycle
// source: React Bench write-react-lobehub-lobe-ui-508
import { useEffect } from "react";

interface AccordionItemState {
  registerItemKey: (itemKey: string) => () => void;
}

interface AccordionItemProps {
  isStandalone: boolean;
  itemKey: string;
  itemState: AccordionItemState | undefined;
}

export const AccordionItem = ({ isStandalone, itemKey, itemState }: AccordionItemProps) => {
  useEffect(() => {
    if (!isStandalone) return itemState?.registerItemKey(itemKey);
  }, [isStandalone, itemKey, itemState]);

  return <div>{itemKey}</div>;
};
