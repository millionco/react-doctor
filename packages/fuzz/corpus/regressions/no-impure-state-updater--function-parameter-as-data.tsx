// rule: no-impure-state-updater
// weakness: alias-guard
// source: https://github.com/millionco/react-doctor/issues/1224
import { useState } from "react";

interface Row {
  readonly id: string;
}

export const Component = () => {
  const [, setSelectedRow] = useState<Row | null>(null);
  const [, setIsOpen] = useState(false);

  const openEditModal = (row: Row): void => {
    setSelectedRow(row);
    setIsOpen(true);
  };

  return (
    <button type="button" onClick={() => openEditModal({ id: "example" })}>
      Open
    </button>
  );
};
