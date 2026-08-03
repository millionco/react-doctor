export interface ActiveTuiRenderer {
  readonly clear: () => void;
}

let activeTuiRenderer: ActiveTuiRenderer | null = null;

export const registerActiveTuiRenderer = (renderer: ActiveTuiRenderer): (() => void) => {
  activeTuiRenderer = renderer;
  return () => {
    if (activeTuiRenderer === renderer) activeTuiRenderer = null;
  };
};

export const clearActiveTuiRenderer = (): void => {
  const renderer = activeTuiRenderer;
  activeTuiRenderer = null;
  renderer?.clear();
};
