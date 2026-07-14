import React from "react";
import { createPortal } from "react-dom";

export const AssigneeResolver = ({ children }): React.ReactElement => children();

export function AppShortcutMenu(): JSX.Element | null {
  const paletteContent = <div />;
  return createPortal(paletteContent, document.body);
}
