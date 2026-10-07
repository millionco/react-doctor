// rule: prefer-use-effect-event
// weakness: literal-identity
// source: react-bench write-react-theduffman85-crowdse__mtbD7Sh
import { useEffect } from "react";

interface ModalProps {
  disableClose: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export const Modal = ({ disableClose, isOpen, onClose }: ModalProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableClose) onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [disableClose, isOpen, onClose]);

  return null;
};
