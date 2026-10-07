import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRendererDomAttachment } from "./three-require-renderer-dom-attachment.js";

describe("three-require-renderer-dom-attachment", () => {
  it("reports a rendering WebGLRenderer whose generated canvas is never attached", () => {
    const code = `
      import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer({ antialias: true });
      renderer.render(new Scene(), new PerspectiveCamera());
    `;
    expect(runRule(threeRequireRendererDomAttachment, code).diagnostics).toHaveLength(1);
  });

  it("allows supplied, directly attached, and externally mounted canvases", () => {
    const code = `
      import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
      const supplied = new WebGLRenderer({ canvas });
      supplied.render(new Scene(), new PerspectiveCamera());
      const attached = new WebGLRenderer();
      container.appendChild(attached.domElement);
      attached.render(new Scene(), new PerspectiveCamera());
      const mounted = new WebGLRenderer();
      mountCanvas(mounted.domElement);
      mounted.render(new Scene(), new PerspectiveCamera());
    `;
    expect(runRule(threeRequireRendererDomAttachment, code).diagnostics).toHaveLength(0);
  });

  it("ignores unused, escaped, dynamic, and lookalike renderers", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const unused = new WebGLRenderer();
      const escaped = new WebGLRenderer();
      configure(escaped);
      const dynamic = new WebGLRenderer(options);
      class LocalRenderer { render() {} }
      const local = new LocalRenderer();
      local.render();
    `;
    expect(runRule(threeRequireRendererDomAttachment, code).diagnostics).toHaveLength(0);
  });

  it("preserves diagnostics through transparent receiver wrappers", () => {
    const code = `
      import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      (renderer as any).render(new Scene(), new PerspectiveCamera());
    `;
    expect(runRule(threeRequireRendererDomAttachment, code).diagnostics).toHaveLength(1);
  });
});
