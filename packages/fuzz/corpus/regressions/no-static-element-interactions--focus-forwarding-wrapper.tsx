// rule: no-static-element-interactions
// verdict: pass
// weakness: wrapper-transparency
// source: React Bench write-react-automattic-vip-design-system-635

interface FocusForwardingWrapperProps {
  controlId: string;
  isInline: boolean;
}

export const FocusForwardingWrapper = ({ controlId, isInline }: FocusForwardingWrapperProps) => {
  const focusControl = (event: React.MouseEvent) => {
    if (event.target.closest(".chip")) return;
    const input = document.querySelector(`#${controlId}`);
    input?.focus();
  };

  return (
    <div onClick={isInline ? focusControl : undefined}>
      <input id={controlId} />
    </div>
  );
};
