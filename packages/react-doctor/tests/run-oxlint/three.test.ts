import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { discoverProject, runOxlint } from "@react-doctor/core";

describe("runOxlint standalone Three.js support", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-three-"));
    fs.mkdirSync(path.join(rootDirectory, "src"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("reports Three.js animation-loop issues without React", async () => {
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "standalone-three", dependencies: { three: "0.185.1" } }),
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/main.ts"),
      `
        import * as THREE from "three";
        const renderer = new THREE.WebGLRenderer();
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const frame = () => {
          renderer.render(scene, camera);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      `,
    );

    const project = discoverProject(rootDirectory);
    const diagnostics = await runOxlint({
      rootDirectory,
      project,
      includePaths: ["src/main.ts"],
      perFileLintCacheEnabled: false,
    });

    expect(project).toMatchObject({ hasThree: true, reactVersion: null });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "three-prefer-set-animation-loop" }),
      ]),
    );
  });
});
