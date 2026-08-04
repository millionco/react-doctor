interface MenuItemProperties {
  __scopeContextMenu?: string;
  label: string;
  onSelect: () => void;
}

interface PrimitiveItemProperties {
  label: string;
  onSelect: () => void;
}

const PrimitiveItem = ({ label, onSelect }: PrimitiveItemProperties) => (
  <button type="button" onClick={onSelect}>
    {label}
  </button>
);

const ContextMenuItem = ({ __scopeContextMenu: _scope, ...itemProperties }: MenuItemProperties) => (
  <PrimitiveItem {...itemProperties} />
);

export const Application = () => {
  const selectItem = () => undefined;
  return <ContextMenuItem label="Open" onSelect={selectItem} />;
};
