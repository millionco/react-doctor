import { createRequire } from "node:module";

const requireFromLauncher = createRequire(import.meta.url);
const launcherPackageVersion = requireFromLauncher("../package.json").version;
const requiredBindingExports = [
  "lint",
  "scanReactDoctorFile",
  "reactDoctorNativeScanRuleIds",
  "analyzeReactDoctorProjectGraph",
  "reactDoctorNativeProjectRuleIds",
  "analyzeReactDoctorDuplicateJsx",
];

export const resolveBindingPackageName = (
  platform = process.platform,
  architecture = process.arch,
  linuxLibc,
) => {
  if (platform === "darwin" && architecture === "arm64") {
    return "react-doctor-rust-binding-darwin-arm64";
  }
  if (platform === "darwin" && architecture === "x64") {
    return "react-doctor-rust-binding-darwin-x64";
  }
  const resolvedLinuxLibc = platform === "linux" ? (linuxLibc ?? resolveLinuxLibc()) : undefined;
  if (platform === "linux" && architecture === "arm64" && resolvedLinuxLibc === "gnu") {
    return "react-doctor-rust-binding-linux-arm64-gnu";
  }
  if (platform === "linux" && architecture === "x64" && resolvedLinuxLibc === "gnu") {
    return "react-doctor-rust-binding-linux-x64-gnu";
  }
  if (platform === "win32" && architecture === "x64") {
    return "react-doctor-rust-binding-win32-x64-msvc";
  }
  const target = resolvedLinuxLibc
    ? `${platform}-${architecture}-${resolvedLinuxLibc}`
    : `${platform}-${architecture}`;
  throw new Error(`react-doctor-rust does not support ${target}.`);
};

export const resolveLinuxLibc = (report = process.report?.getReport()) =>
  typeof report === "object" &&
  report !== null &&
  typeof report.header === "object" &&
  report.header !== null &&
  typeof report.header.glibcVersionRuntime === "string"
    ? "gnu"
    : "musl";

export const loadNativeBinding = ({
  platform = process.platform,
  architecture = process.arch,
  linuxLibc,
  resolveModule = requireFromLauncher.resolve,
  loadModule = requireFromLauncher,
  resolvePackageVersion = (packageName) =>
    requireFromLauncher(`${packageName}/package.json`).version,
} = {}) => {
  const packageName = resolveBindingPackageName(platform, architecture, linuxLibc);
  let bindingPackageVersion;
  try {
    bindingPackageVersion = resolvePackageVersion(packageName);
  } catch {
    throw new Error(
      `The native package ${packageName} is missing. Reinstall react-doctor-rust on this platform.`,
    );
  }
  if (bindingPackageVersion !== launcherPackageVersion) {
    throw new Error(
      `${packageName}@${bindingPackageVersion} is incompatible with react-doctor-rust@${launcherPackageVersion}.`,
    );
  }
  let bindingPath;
  try {
    bindingPath = resolveModule(packageName);
  } catch {
    throw new Error(
      `The native package ${packageName} is missing. Reinstall react-doctor-rust on this platform.`,
    );
  }

  let binding;
  try {
    binding = loadModule(bindingPath);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Unable to load ${packageName}.${detail}`);
  }

  for (const exportName of requiredBindingExports) {
    if (typeof binding?.[exportName] !== "function") {
      throw new Error(`${packageName} is incompatible: missing ${exportName}().`);
    }
  }

  return bindingPath;
};
