import type { CapabilityQuery } from "./capability.js";

export interface RulePackageDependency {
  readonly name: string;
  readonly section:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly rawSpecifier: string;
  readonly resolvedSpecifier: string;
}

export interface RulePackageContext {
  readonly directory: string;
  readonly relativeDirectory: string;
  readonly capabilities: ReadonlySet<string>;
  readonly dependencies: ReadonlyArray<RulePackageDependency>;
  readonly hasCapability: CapabilityQuery;
  readonly hasDependency: (dependencyName: string) => boolean;
  readonly getDependency: (dependencyName: string) => RulePackageDependency | null;
}
