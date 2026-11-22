import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const DOTS_SOURCE =
  "import { useCallback, useEffect, useState } from 'react';\nimport './appearance.css';\nimport useEmblaCarousel from 'embla-carousel-react';\n\nexport function Dots() {\n  const [viewportRef, api] = useEmblaCarousel({ loop: true }, []);\n  const [positions, setPositions] = useState<number[]>([]);\n  const [selectedIndex, setSelectedIndex] = useState(0);\n  useEffect(() => {\n    if (!api) return;\n    setPositions(api.scrollSnapList());\n    const select = () => setSelectedIndex(api.selectedScrollSnap());\n    api.on('select', select);\n    return () => { api.off('select', select); };\n  }, [api]);\n  const goTo = useCallback((index: number) => {\n    if (api) api.scrollTo(index);\n  }, [api]);\n  return (\n    <>\n      <div ref={viewportRef}><div><div>One</div><div>Two</div></div></div>\n      <div>\n        {positions.map((_, index) => (\n          <button\n            key={index}\n            type=\"button\"\n            onClick={() => goTo(index)}\n            className={`dot ${index === selectedIndex ? 'active' : 'inactive'}`}\n            aria-label={`Go to position ${index + 1}`}\n          />\n        ))}\n      </div>\n    </>\n  );\n}\n";
const EMBLA_TEST_LOCK =
  '# yarn lockfile v1\n\nembla-carousel-react@^8.6.0:\n  version "8.6.0"\n  resolved "https://registry.npmjs.org/embla-carousel-react/-/embla-carousel-react-8.6.0.tgz"\n  integrity sha512-0/PjqU7geVmo6F734pmPqpyHqiM99olvyecY7zdweCw+6tKEXnrE90pBiBbMMU8s5tICemzpQ3hi5EpxzGW+JA==\n  dependencies:\n    embla-carousel "8.6.0"\n    embla-carousel-reactive-utils "8.6.0"\n\nembla-carousel@8.6.0:\n  version "8.6.0"\n  resolved "https://registry.npmjs.org/embla-carousel/-/embla-carousel-8.6.0.tgz"\n  integrity sha512-SjWyZBHJPbqxHOzckOfo8lHisEaJWmwd23XppYFYVh10bU66/Pn5tkVkbkCMZVdbUE5eTCI2nD8OyIP4Z+uwkA==\n\nembla-carousel-reactive-utils@8.6.0:\n  version "8.6.0"\n  resolved "https://registry.npmjs.org/embla-carousel-reactive-utils/-/embla-carousel-reactive-utils-8.6.0.tgz"\n  integrity sha512-fMVUDUEx0/uIEDM0Mz3dHznDhfX+znCCDCeIophYb1QGVM7YThSWX+wz11zlYwWFOr74b4QLGg0hrGPJeG2s4A==\n';
const VITE_STOCK = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });`;

const writeProjectFile = (root: string, relativePath: string, contents: string): string => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const createFixture = (root: string): string => {
  writeProjectFile(
    root,
    "package.json",
    JSON.stringify({
      name: "native-slider-dots-test",
      private: true,
      type: "module",
      scripts: { build: "vite build" },
      dependencies: { react: "^18.3.1", "embla-carousel-react": "^8.6.0" },
      devDependencies: { vite: "^6.2.0", "@vitejs/plugin-react": "^4.4.0" },
    }),
  );
  writeProjectFile(root, "yarn.lock", EMBLA_TEST_LOCK);
  writeProjectFile(root, "vite.config.js", VITE_STOCK);
  writeProjectFile(root, "index.html", '<script type="module" src="/src/Dots.tsx"></script>');
  writeProjectFile(
    root,
    "src/appearance.css",
    '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;600");',
  );
  return writeProjectFile(root, "src/Dots.tsx", DOTS_SOURCE);
};

describe("position-only native carousel buttons", () => {
  it.each(["curated", "upstream"])(
    "preserves the warning when a reachable provider changes (%s)",
    (portedRuleMode) => {
      const root = mkdtempSync(join(tmpdir(), "rd-positional-carousel-"));
      try {
        const filename = createFixture(root);
        writeProjectFile(root, "src/Unused.ts", "export const unusable = ;");
        const diagnose = () =>
          runRule(noArrayIndexAsKey, DOTS_SOURCE, {
            filename,
            settings: { "react-doctor": { rootDirectory: root, portedRuleMode } },
          });
        expect(diagnose()).toEqual({ diagnostics: [], parseErrors: [] });

        writeProjectFile(
          root,
          "src/setup.ts",
          'import useCarousel from "embla-carousel-react"; useCarousel.globalOptions = configure();',
        );
        writeProjectFile(root, "src/start.ts", 'import "./setup"; import "./Dots";');
        writeProjectFile(root, "index.html", '<script type="module" src="/src/start.ts"></script>');
        expect(diagnose().diagnostics).toHaveLength(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
