// rule: no-static-element-interactions

interface FocusableKeyboardTargetProps {
  handleOnKeyDown: () => void;
}

export const FocusableKeyboardTarget = ({ handleOnKeyDown }: FocusableKeyboardTargetProps) => (
  <div tabIndex={0} onKeyDown={handleOnKeyDown} />
);
