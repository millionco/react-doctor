import { useState } from "react";

export const Disclosure = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [formatter, setFormatter] = useState({
    format: (value: string) => value,
  });

  return (
    <button
      type="button"
      onClick={() => {
        setIsOpen(true);
        setFormatter({ format: (value) => value.trim() });
      }}
    >
      {isOpen ? "Open" : "Closed"}
      <span>{typeof formatter.format}</span>
    </button>
  );
};
