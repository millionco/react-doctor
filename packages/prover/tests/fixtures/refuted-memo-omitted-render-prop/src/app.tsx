import { memo } from "react";

interface MenuProperties {
  label: string;
  menuGroups: ReadonlyArray<string>;
}

const MenuView = ({ label, menuGroups }: MenuProperties) => (
  <nav aria-label={label}>{menuGroups.join(", ")}</nav>
);

export const Menu = memo(
  MenuView,
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
