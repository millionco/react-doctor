// rule: no-many-boolean-props
// weakness: name-heuristic
// source: FP-FIX history (show*/hide*/enable* props that are callbacks, not flags)
interface ToolbarProps {
  showMenu: () => void;
  hideMenu: () => void;
  enableSave: () => void;
  disableSave: () => void;
}

export const Toolbar = ({
  showMenu: openMenu,
  hideMenu,
  enableSave,
  disableSave,
}: ToolbarProps) => (
  <div onClick={openMenu}>
    <button onClick={() => setTimeout(hideMenu, 100)}>hide</button>
    <button onClick={enableSave}>on</button>
    <button onClick={disableSave}>off</button>
  </div>
);
