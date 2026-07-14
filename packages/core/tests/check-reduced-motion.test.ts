import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkReducedMotion } from "../src/check-reduced-motion.js";

describe("checkReducedMotion", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "check-reduced-motion-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeNestedFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  const writePackageJson = (
    motionDependencySection: "dependencies" | "devDependencies" | null = "dependencies",
  ): void => {
    const packageJson =
      motionDependencySection === null
        ? { name: "app", dependencies: { react: "^19.0.0" } }
        : {
            name: "app",
            [motionDependencySection]: { react: "^19.0.0", "framer-motion": "^12.0.0" },
          };
    writeNestedFile("package.json", JSON.stringify(packageJson));
  };

  const writeDirectMotionUse = (): void => {
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );
  };

  const initializeGitRepository = (): void => {
    const runGit = (...arguments_: string[]): void => {
      const result = spawnSync("git", arguments_, { cwd: temporaryDirectory });
      expect(result.status).toBe(0);
    };
    runGit("init", "--quiet");
    runGit("add", "-A");
    runGit(
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "-m",
      "initial",
    );
  };

  it("stays clean when a motion dependency is declared but unused", () => {
    writePackageJson();
    writeNestedFile("src/app.ts", `export const renderLabel = (): string => "ready";\n`);

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when an unused motion import is present", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
export const App = () => <div>still</div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when only a type import is present", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import type { MotionProps } from "framer-motion";
export const props: MotionProps = {};
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when runtime motion and type imports are both unused", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion, type MotionProps } from "framer-motion";
export const App = (_props: MotionProps) => <div>still</div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when an unused motion dependency is declared as a dev dependency", () => {
    writePackageJson("devDependencies");
    writeNestedFile("src/app.ts", `export const renderLabel = (): string => "ready";\n`);

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports direct motion component use without handling", () => {
    writePackageJson();
    writeDirectMotionUse();

    const diagnostics = checkReducedMotion(temporaryDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: "package.json",
      rule: "require-reduced-motion",
      line: 0,
      column: 0,
    });
  });

  it("reports an aliased motion component import", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion as animated } from "framer-motion";
export const App = () => <animated.div>moving</animated.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a namespace motion component", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import * as Framer from "framer-motion";
export const App = () => <Framer.motion.div>moving</Framer.motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a Reorder item", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { Reorder } from "framer-motion";
export const App = () => <Reorder.Item value="one">moving</Reorder.Item>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("stays clean when only a Reorder group is rendered", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { Reorder } from "framer-motion";
export const App = () => <Reorder.Group values={[]} onReorder={() => {}} />;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when AnimatePresence has no motion child", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { AnimatePresence } from "framer-motion";
export const App = () => <AnimatePresence><div>still</div></AnimatePresence>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports motion use imported from the motion react subpath", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "motion/react";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a computed namespace motion component alias", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import * as Framer from "framer-motion";
const AnimatedCard = Framer["motion"]["div"];
export const App = () => <AnimatedCard>moving</AnimatedCard>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a module-local motion component wrapper", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const AnimatedCard = motion.div;
export const App = () => <AnimatedCard>moving</AnimatedCard>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("stays clean when a module-local motion component wrapper is never rendered", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const AnimatedCard = motion.div;
export const App = () => <div>still</div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports a motion component imported through a local re-export", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `export { motion as animated } from "framer-motion";
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import { animated } from "./motion";
export const App = () => <animated.div animate={{ x: 120 }}>moving</animated.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports an exported module-local motion wrapper", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `import { motion } from "framer-motion";
export const AnimatedCard = motion.div;
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import { AnimatedCard } from "./motion";
export const App = () => <AnimatedCard animate={{ x: 120 }}>moving</AnimatedCard>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a default-exported motion wrapper", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `import { motion } from "framer-motion";
export default motion;
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import animated from "./motion";
export const App = () => <animated.div animate={{ x: 120 }}>moving</animated.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("keeps a default-exported non-motion binding clean", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `import { useScroll } from "framer-motion";
export default useScroll;
`,
    );
    writeNestedFile(
      "src/app.ts",
      `import readScroll from "./motion";
export const usePosition = () => readScroll();
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports a local re-export imported with an explicit JavaScript extension", () => {
    writePackageJson();
    writeNestedFile("src/motion.ts", `export { motion } from "framer-motion";\n`);
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "./motion.js";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a motion component imported through a star re-export", () => {
    writePackageJson();
    writeNestedFile("src/motion.ts", `export * from "framer-motion";\n`);
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "./motion";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("continues past an unrelated star re-export to a later motion alias", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `export * from "framer-motion";
export { motion as animated } from "framer-motion";
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import { animated } from "./motion";
export const App = () => <animated.div animate={{ x: 120 }}>moving</animated.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("keeps a non-motion alias after a star re-export clean", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion.ts",
      `export * from "framer-motion";
export { useScroll as readScroll } from "framer-motion";
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import { readScroll } from "./motion";
export const usePosition = () => readScroll();
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when a motion re-export is never imported", () => {
    writePackageJson();
    writeNestedFile("src/motion.ts", `export { motion } from "framer-motion";\n`);
    writeNestedFile("src/app.tsx", `export const App = () => <div>still</div>;\n`);

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("resolves a motion component through circular star re-exports", () => {
    writePackageJson();
    writeNestedFile(
      "src/motion-a.ts",
      `export * from "./motion-b";
`,
    );
    writeNestedFile(
      "src/motion-b.ts",
      `export * from "./motion-a";
export * from "framer-motion";
`,
    );
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "./motion-a";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a destructured namespace motion component", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import * as Framer from "framer-motion";
const { motion: animated } = Framer;
export const App = () => <animated.div animate={{ x: 120 }}>moving</animated.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a destructured motion element", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const { div: AnimatedDiv } = motion;
export const App = () => <AnimatedDiv animate={{ x: 120 }}>moving</AnimatedDiv>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a real animate function call", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { animate as runAnimation } from "framer-motion";
export const start = (): void => { runAnimation("#box", { x: 120 }); };
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a motion component loaded through global require", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `const { motion } = require("framer-motion");
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("stays clean when require is a local lookalike", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `const require = (_moduleName: string) => ({ motion: { div: "div" } });
const { motion } = require("framer-motion");
export const App = () => <motion.div>still</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports animate invoked through Function call", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { animate } from "framer-motion";
export const start = (): void => { animate.call(undefined, "#box", { x: 120 }); };
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("reports a bound animate function when the bound function is invoked", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { animate } from "framer-motion";
const animateBox = animate.bind(undefined, "#box");
export const start = (): void => { animateBox({ x: 120 }); };
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("stays clean when a non-animation property on animate is called", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { animate } from "framer-motion";
export const describe = (): string => animate.toString();
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when inView only observes visibility", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { inView } from "framer-motion";
export const observe = (): void => { inView("#target", () => undefined); };
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when a motion value is created without visual motion", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { useMotionValue } from "framer-motion";
export const useCurrentPosition = () => useMotionValue(0);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("stays clean when stagger only creates a delay function", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.ts",
      `import { stagger } from "framer-motion";
export const delayByIndex = stagger(0.1);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("accepts MotionConfig from the real library with user preference handling", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig as Config, motion } from "framer-motion";
export const App = () => (
  <Config reducedMotion="user">
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </Config>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("accepts namespace MotionConfig with always-reduced handling", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import * as Framer from "framer-motion";
export const App = () => (
  <Framer.MotionConfig reducedMotion={"always"}>
    <Framer.motion.div animate={{ x: 120 }}>moving</Framer.motion.div>
  </Framer.MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept MotionConfig configured to ignore reduced-motion preferences", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig, motion } from "framer-motion";
export const App = () => (
  <MotionConfig reducedMotion="never">
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("accepts a statically resolved MotionConfig preference", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig, motion } from "framer-motion";
const preference = "user";
export const App = () => (
  <MotionConfig reducedMotion={preference}>
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept a runtime MotionConfig preference", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig, motion } from "framer-motion";
export const App = ({ preference }: { preference: "always" | "never" | "user" }) => (
  <MotionConfig reducedMotion={preference}>
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("stays clean when MotionConfig is rendered without any motion component", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig } from "framer-motion";
export const App = () => <MotionConfig reducedMotion="never"><div>still</div></MotionConfig>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept reduced-motion configuration on an arbitrary nested member", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { MotionConfig, motion } from "framer-motion";
const Provider = (MotionConfig as unknown as { Provider: typeof MotionConfig }).Provider;
export const App = () => (
  <Provider reducedMotion="user">
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </Provider>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("accepts a called useReducedMotion import from the real library", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion, useReducedMotion as usePreference } from "framer-motion";
export const App = () => {
  const shouldReduceMotion = usePreference();
  return <motion.div animate={{ x: shouldReduceMotion ? 0 : 120 }}>moving</motion.div>;
};
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept an ignored useReducedMotion result", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion, useReducedMotion } from "framer-motion";
export const App = () => {
  useReducedMotion();
  return <motion.div animate={{ x: 120 }}>moving</motion.div>;
};
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a voided useReducedMotion result", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion, useReducedMotion } from "framer-motion";
export const App = () => {
  void useReducedMotion();
  return <motion.div animate={{ x: 120 }}>moving</motion.div>;
};
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept an unused useReducedMotion import", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion, useReducedMotion } from "framer-motion";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not mistake a shadowing local motion binding for library use", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const renderLocalElement = (motion: { div: string }) => motion.div;
export const App = () => <div>{renderLocalElement({ div: "still" })}</div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not mistake a similarly named package for motion-library use", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion-utils";
export const App = () => <motion.div>still</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept a MotionConfig token in a comment", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
// Documentation mentions MotionConfig but no provider is installed.
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a useReducedMotion token in a string", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const documentationSearchTerm = "useReducedMotion";
export const App = () => <motion.div data-docs={documentationSearchTerm} animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept an unrelated reducedMotion identifier", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const reducedMotionDocumentationUrl = "/help/animation";
export const App = () => <motion.div data-docs={reducedMotionDocumentationUrl} animate={{ x: 120 }}>moving</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a locally defined useReducedMotion lookalike", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const useReducedMotion = (): boolean => true;
export const App = () => {
  useReducedMotion();
  return <motion.div animate={{ x: 120 }}>moving</motion.div>;
};
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a locally defined MotionConfig lookalike", () => {
    writePackageJson();
    writeNestedFile(
      "src/app.tsx",
      `import { motion } from "framer-motion";
const MotionConfig = ({ children }: { children: unknown }) => children;
export const App = () => (
  <MotionConfig reducedMotion="user">
    <motion.div animate={{ x: 120 }}>moving</motion.div>
  </MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("accepts a parsed reduced-motion CSS media rule", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/styles.css",
      `@media screen and (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms; }
}
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("does not accept a reduced-motion token in a CSS comment", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/styles.css",
      `/* prefers-reduced-motion support is tracked separately. */
.card { transform: translateX(0); }
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a reduced-motion media query in a Sass line comment", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/styles.scss",
      `// @media (prefers-reduced-motion: reduce) { * { animation: none; } }
.card { transform: translateX(0); }
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept a reduced-motion media query inside a CSS string", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/styles.css",
      `.card::before { content: "@media (prefers-reduced-motion: reduce) { * { animation: none; } }"; }
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept an inverted reduced-motion media query", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/styles.css",
      `@media not (prefers-reduced-motion: reduce) {
  .card { animation: pulse 1s infinite; }
}
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("does not accept an empty reduced-motion media query", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile("src/styles.css", `@media (prefers-reduced-motion: reduce) {}\n`);

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("combines motion use and handling from separate source files", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "src/providers.tsx",
      `import { MotionConfig } from "framer-motion";
export const Providers = ({ children }: { children: unknown }) => (
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("ignores handling that only lives in an ignored build directory", () => {
    writePackageJson();
    writeDirectMotionUse();
    writeNestedFile(
      "dist/bundle.css",
      `@media (prefers-reduced-motion: reduce) { * { animation: none; } }\n`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("ignores motion use that only lives in an ignored build directory", () => {
    writePackageJson();
    writeNestedFile("src/app.ts", `export const renderLabel = (): string => "ready";\n`);
    writeNestedFile(
      "dist/bundle.js",
      `import { motion } from "framer-motion"; motion.div({ animate: { x: 120 } });\n`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("finds real handling in an untracked source file", () => {
    writePackageJson();
    writeDirectMotionUse();
    initializeGitRepository();
    writeNestedFile(
      "src/providers.tsx",
      `import { MotionConfig } from "framer-motion";
export const Providers = ({ children }: { children: unknown }) => (
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
);
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("returns the same verdict for Git and non-Git trees", () => {
    writePackageJson();
    writeDirectMotionUse();
    const nonGitDiagnostics = checkReducedMotion(temporaryDirectory);
    initializeGitRepository();

    expect(checkReducedMotion(temporaryDirectory)).toEqual(nonGitDiagnostics);
    expect(nonGitDiagnostics).toHaveLength(1);
  });

  it("returns no diagnostics when the project has no motion library", () => {
    writePackageJson(null);
    writeNestedFile(
      "src/app.tsx",
      `const motion = { div: "div" };
export const App = () => <motion.div>still</motion.div>;
`,
    );

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });
});
