// rule: click-events-have-key-events
// weakness: focus-forwarding-wrapper
// source: adversarial audit of ReactBench write-react-automattic-vip-desig__eF5Ecq5
// verdict: fail

interface UploadProps {
  enabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export const Upload = ({ enabled, inputRef }: UploadProps) => {
  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target.closest(".chip")) return;
    inputRef.current?.click();
  };

  return <div onClick={enabled ? handleContainerClick : undefined}>Upload</div>;
};
