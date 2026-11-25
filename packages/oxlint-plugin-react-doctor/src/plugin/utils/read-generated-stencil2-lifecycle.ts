interface GeneratedStencilLifecycle {
  readonly buildTask: string;
  readonly componentTask: string;
  readonly source: string;
  readonly generatedConfig: "stencil.config.js";
  readonly externalPackage: "lightningcss";
  readonly createsLibraryDirectory: boolean;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const task = "[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*";
const productionTask = new RegExp("^pnpm run (" + task + ")$", "u");
const componentTask = new RegExp("^cross-env NODE_ENV=production run-s (" + task + ")$", "u");
const configProducer =
  /^esbuild \.(\/scripts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.ts) --external:lightningcss --bundle --platform=node --outfile=stencil\.config\.js$/u;

export const readGeneratedStencil2Lifecycle = (
  manifestText: string,
): GeneratedStencilLifecycle | null => {
  try {
    const manifest = object(JSON.parse(manifestText));
    const scripts = object(manifest?.scripts);
    if (!scripts || typeof scripts.prod !== "string") return null;
    const buildTask = productionTask.exec(scripts.prod)?.[1];
    if (!buildTask || typeof scripts[buildTask] !== "string") return null;
    const selected = componentTask.exec(scripts[buildTask])?.[1];
    if (
      !selected ||
      scripts[selected] !== "stencil build" ||
      scripts["pre" + buildTask] !== "run-p generate:*"
    )
      return null;
    const generator = scripts["generate:stencil-config"];
    if (typeof generator !== "string") return null;
    const source = configProducer.exec(generator)?.[1];
    if (!source) return null;
    const directories = scripts["generate:lib"];
    if (directories !== undefined && directories !== "mkdirp lib") return null;
    if (
      Object.keys(scripts).some(
        (name) =>
          name.startsWith("generate:") &&
          name !== "generate:lib" &&
          name !== "generate:stencil-config",
      )
    )
      return null;
    for (const name of ["prod", selected, "generate:stencil-config", "generate:lib"]) {
      if (Object.hasOwn(scripts, "pre" + name) || Object.hasOwn(scripts, "post" + name))
        return null;
    }
    if (Object.hasOwn(scripts, "post" + buildTask)) return null;
    return {
      buildTask,
      componentTask: selected,
      source: "." + source,
      generatedConfig: "stencil.config.js",
      externalPackage: "lightningcss",
      createsLibraryDirectory: directories !== undefined,
    };
  } catch {
    return null;
  }
};
