// rule: click-events-have-key-events
// weakness: focus-forwarding-wrapper
// source: ReactBench write-react-automattic-vip-desig__eF5Ecq5
// verdict: pass

interface FieldProps {
  forLabel: string;
  variant: string;
}

export const Field = ({ forLabel, variant }: FieldProps) => {
  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target.closest(".chip")) return;
    const input = globalThis.document.querySelector(`#${forLabel}`);
    input?.focus();
  };

  return (
    <div onClick={variant === "chips" ? handleContainerClick : undefined}>
      <Autocomplete id={forLabel} />
    </div>
  );
};
