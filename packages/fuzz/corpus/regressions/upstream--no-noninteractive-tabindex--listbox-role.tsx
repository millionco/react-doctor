// rule: jsx-a11y/no-noninteractive-tabindex
// weakness: other
// source: oxc-project/oxc#20855 (tabIndex on role="listbox" wrongly flagged)
export const LayerListbox = ({ activeLayerId }: { activeLayerId?: string }) => (
  <div
    role="listbox"
    aria-label="Layers"
    aria-multiselectable="true"
    aria-activedescendant={activeLayerId ?? undefined}
    tabIndex={0}
  >
    <div role="option" aria-selected={false}>
      Item 1
    </div>
    <div role="option" aria-selected={true}>
      Item 2
    </div>
  </div>
);
