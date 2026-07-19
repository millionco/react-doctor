// rule: jsx-no-constructed-context-values
// source: ASAP_FIX Lobe UI write-react-lobehub-lobe-ui-508__hddXHTF
// react-major: 19

import { AccordionExpansionContext } from "./context";

interface AccordionProps {
  expandedKeys: ReadonlyArray<string>;
  onToggle: (key: string) => void;
}

export const Accordion = ({ expandedKeys, onToggle }: AccordionProps) => (
  <AccordionExpansionContext value={{ expandedKeys, onToggle }} />
);
