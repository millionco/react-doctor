import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

const OxlintUnavailableKind = Schema.Literals(["binary-not-found", "native-binding-missing"]);

export class OxlintUnavailable extends Schema.TaggedErrorClass<OxlintUnavailable>()(
  "OxlintUnavailable",
  {
    kind: OxlintUnavailableKind,
    detail: Schema.String,
  },
) {
  get message() {
    return this.kind === "binary-not-found"
      ? `oxlint binary not found: ${this.detail}`
      : `oxlint native binding missing: ${this.detail}`;
  }
}

const OxlintBatchExceededKind = Schema.Literals(["timeout", "output-too-large", "oom", "killed"]);

export class OxlintBatchExceeded extends Schema.TaggedErrorClass<OxlintBatchExceeded>()(
  "OxlintBatchExceeded",
  {
    kind: OxlintBatchExceededKind,
    detail: Schema.String,
  },
) {
  get message() {
    switch (this.kind) {
      case "timeout":
        return `oxlint batch timed out: ${this.detail}`;
      case "output-too-large":
        return `oxlint batch output exceeded limit: ${this.detail}`;
      case "oom":
        return `oxlint batch ran out of memory: ${this.detail}`;
      case "killed":
        return `oxlint batch was killed: ${this.detail}`;
    }
  }
}

export class OxlintSpawnFailed extends Schema.TaggedErrorClass<OxlintSpawnFailed>()(
  "OxlintSpawnFailed",
  {
    cause: Schema.Unknown,
  },
) {
  get message() {
    return `Failed to run oxlint: ${Cause.pretty(Cause.fail(this.cause))}`;
  }
}

export class OxlintOutputUnparseable extends Schema.TaggedErrorClass<OxlintOutputUnparseable>()(
  "OxlintOutputUnparseable",
  {
    preview: Schema.String,
  },
) {
  get message() {
    return `Failed to parse oxlint output: ${this.preview}`;
  }
}

export class ConfigParseFailed extends Schema.TaggedErrorClass<ConfigParseFailed>()(
  "ConfigParseFailed",
  {
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {
  get message() {
    return `Failed to parse react-doctor config at ${this.path}: ${Cause.pretty(Cause.fail(this.cause))}`;
  }
}

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()("ProjectNotFound", {
  directory: Schema.String,
}) {
  get message() {
    return `Could not find a React project at ${this.directory}`;
  }
}

export class NoReactDependency extends Schema.TaggedErrorClass<NoReactDependency>()(
  "NoReactDependency",
  {
    directory: Schema.String,
  },
) {
  get message() {
    return `No React dependency found in ${this.directory}`;
  }
}

export class AmbiguousProject extends Schema.TaggedErrorClass<AmbiguousProject>()(
  "AmbiguousProject",
  {
    directory: Schema.String,
    candidates: Schema.Array(Schema.String),
  },
) {
  get message() {
    return `Ambiguous project at ${this.directory}: found ${this.candidates.length} candidates (${this.candidates.join(", ")})`;
  }
}

export class DeadCodeAnalysisFailed extends Schema.TaggedErrorClass<DeadCodeAnalysisFailed>()(
  "DeadCodeAnalysisFailed",
  {
    cause: Schema.Unknown,
  },
) {
  get message() {
    return `Dead-code analysis failed: ${Cause.pretty(Cause.fail(this.cause))}`;
  }
}

export class GitInvocationFailed extends Schema.TaggedErrorClass<GitInvocationFailed>()(
  "GitInvocationFailed",
  {
    args: Schema.Array(Schema.String),
    directory: Schema.String,
    cause: Schema.Unknown,
  },
) {
  get message() {
    return `git ${this.args.join(" ")} (cwd=${this.directory}) failed: ${Cause.pretty(Cause.fail(this.cause))}`;
  }
}

export class GitBaseBranchMissing extends Schema.TaggedErrorClass<GitBaseBranchMissing>()(
  "GitBaseBranchMissing",
  {
    branch: Schema.String,
  },
) {
  get message() {
    return `Diff base branch "${this.branch}" does not exist (run \`git fetch\` to update remote refs).`;
  }
}

export class GitBaseBranchInvalid extends Schema.TaggedErrorClass<GitBaseBranchInvalid>()(
  "GitBaseBranchInvalid",
  {
    detail: Schema.String,
  },
) {
  get message() {
    return this.detail;
  }
}

export const ReactDoctorErrorReason = Schema.Union([
  OxlintUnavailable,
  OxlintBatchExceeded,
  OxlintSpawnFailed,
  OxlintOutputUnparseable,
  ConfigParseFailed,
  ProjectNotFound,
  NoReactDependency,
  AmbiguousProject,
  DeadCodeAnalysisFailed,
  GitInvocationFailed,
  GitBaseBranchMissing,
  GitBaseBranchInvalid,
]);

export type ReactDoctorErrorReason = Schema.Schema.Type<typeof ReactDoctorErrorReason>;

export class ReactDoctorError extends Schema.TaggedErrorClass<ReactDoctorError>()(
  "ReactDoctorError",
  {
    reason: ReactDoctorErrorReason,
  },
) {
  get message() {
    return this.reason.message;
  }
}

export const formatReactDoctorError = (error: ReactDoctorError): string => error.reason.message;

export const isSplittableReactDoctorError = (error: unknown): error is ReactDoctorError =>
  error instanceof ReactDoctorError && error.reason._tag === "OxlintBatchExceeded";

export const isReactDoctorError = (error: unknown): error is ReactDoctorError =>
  error instanceof ReactDoctorError;
