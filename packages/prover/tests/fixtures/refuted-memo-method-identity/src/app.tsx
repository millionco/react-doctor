import { memo } from "react";

interface MenuProperties {
  menuGroups: ReadonlyArray<string>;
}

const MenuView = ({ menuGroups }: MenuProperties) => <nav>{menuGroups.join(", ")}</nav>;

export const Menu = memo(
  MenuView,
  (previousProperties, nextProperties) =>
    previousProperties.menuGroups.join === nextProperties.menuGroups.join,
);
