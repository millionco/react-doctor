export interface ActiveTuiRenderer {
  readonly preserveOutput: () => void;
}

let activeTuiRenderer: ActiveTuiRenderer | null = null;

export const registerActiveTuiRenderer = (renderer: ActiveTuiRenderer): (() => void) => {
  activeTuiRenderer = renderer;
  return () => {
    if (activeTuiRenderer === renderer) activeTuiRenderer = null;
  };
};

export const preserveActiveTuiRendererOutput = (): void => {
  const renderer = activeTuiRenderer;
  activeTuiRenderer = null;
  renderer?.preserveOutput();
};
