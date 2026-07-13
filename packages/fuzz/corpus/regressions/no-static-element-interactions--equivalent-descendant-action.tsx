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

export const AliasedDisabledEditableCell = ({ disabled, setOpen }: EditableCellProps) => {
  const noAction = null;
  return (
    <div onClick={disabled ? noAction : () => setOpen(true)}>
      <Button aria-label="Edit" onPress={() => setOpen(true)}>
        Edit
      </Button>
    </div>
  );
};

export const AriaDisabledEditCell = ({ setOpen }: EditableCellProps) => (
  <div onClick={() => setOpen(true)}>
    <Button aria-disabled="true" aria-label="Edit" onPress={() => setOpen(true)}>
      Edit
    </Button>
  </div>
);

export const CustomElementEditCell = ({ setOpen }: EditableCellProps) => (
  <div onClick={() => setOpen(true)}>
    <app-button aria-label="Edit" onClick={() => setOpen(true)}>
      Edit
    </app-button>
  </div>
);
