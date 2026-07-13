// rule: click-events-have-key-events, no-static-element-interactions
// weakness: control-flow
// source: React Bench write-react-marigold-ui-marigold-5520

import { Button } from "react-aria-components";

interface EditableCellProps {
  disabled: boolean;
  setOpen: (isOpen: boolean) => void;
}

export const EditableCell = ({ disabled, setOpen }: EditableCellProps) => (
  <div onClick={disabled ? undefined : () => setOpen(true)}>
    {!disabled && (
      <div>
        <Button aria-label="Edit" onPress={() => setOpen(true)}>
          Edit
        </Button>
      </div>
    )}
  </div>
);
