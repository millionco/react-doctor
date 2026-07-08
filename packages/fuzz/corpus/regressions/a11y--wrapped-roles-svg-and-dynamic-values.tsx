// rule: no-static-element-interactions, no-aria-hidden-on-focusable, img-redundant-alt, no-noninteractive-tabindex
// weakness: jsx-expression-container-literal, svg-implicit-role, dynamic-aria-hidden, word-boundaries, roving-tabindex
// source: differential vs eslint-plugin-jsx-a11y (mantine, nivo, next.js examples)
export const WrappedRole = ({ onClick }: { onClick: () => void }) => (
  <div role={"link"} onClick={onClick} onKeyDown={onClick} tabIndex={0} />
);

export const SvgCanvas = ({ onClick }: { onClick: () => void }) => (
  <svg width="100vw" height="100vh" onClick={onClick} onKeyDown={onClick} />
);

export const MaybeHiddenControl = ({ interactive }: { interactive: boolean }) => (
  <button type="button" aria-hidden={!interactive || undefined}>
    bold
  </button>
);

export const PositionedImages = () => (
  <div>
    <img src="/hero.png" alt="image-left-top" />
    <img src="/thumb.png" alt="my_image_1" />
  </div>
);

export const RovingTabs = ({ isActive }: { isActive: boolean }) => (
  <div role="tab" tabIndex={isActive ? 0 : -1}>
    tab
  </div>
);
