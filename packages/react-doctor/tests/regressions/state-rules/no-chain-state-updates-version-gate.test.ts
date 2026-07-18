import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-chain-state-updates-version-gate");

const SOURCE = `import { useCallback, useEffect, useRef, useState } from "react";

export const Gallery = ({ activePhotoIndex, photos, wrap }) => {
  const [zoom, setZoom] = useState({ scale: 1, panX: 0, panY: 0 });
  const [state, setState] = useState({ activePhotoIndex: 0, hidePrevButton: false });
  const zoomRef = useRef(zoom);
  const setZoomState = useCallback((nextZoom) => {
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);
  const resetZoom = useCallback(
    () => setZoomState({ scale: 1, panX: 0, panY: 0 }),
    [setZoomState],
  );

  useEffect(() => {
    setState((previousState) => ({
      ...previousState,
      activePhotoIndex,
      hidePrevButton: photos.length === 0 || !wrap,
    }));
    resetZoom();
  }, [activePhotoIndex, photos, resetZoom, wrap]);

  return (
    <button
      type="button"
      onClick={() => setZoomState({ scale: 2, panX: 0, panY: 0 })}
    >
      {zoom.scale + state.activePhotoIndex}
    </button>
  );
};
`;

const setupProject = (name: string, reactMajorVersion: number): string =>
  setupReactProject(tempRoot, name, {
    reactVersion: `^${reactMajorVersion}.0.0`,
    files: { "src/gallery.tsx": SOURCE },
  });

describe("no-chain-state-updates version gate", () => {
  it("reports the callback-mediated chain on React 17", async () => {
    const projectDirectory = setupProject("react-17", 17);

    const diagnostics = await collectRuleHits(projectDirectory, "no-chain-state-updates", {
      reactMajorVersion: 17,
    });

    expect(diagnostics).toHaveLength(1);
  });

  it("stays silent on React 18", async () => {
    const projectDirectory = setupProject("react-18", 18);

    const diagnostics = await collectRuleHits(projectDirectory, "no-chain-state-updates", {
      reactMajorVersion: 18,
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on React 19", async () => {
    const projectDirectory = setupProject("react-19", 19);

    const diagnostics = await collectRuleHits(projectDirectory, "no-chain-state-updates", {
      reactMajorVersion: 19,
    });

    expect(diagnostics).toHaveLength(0);
  });
});
