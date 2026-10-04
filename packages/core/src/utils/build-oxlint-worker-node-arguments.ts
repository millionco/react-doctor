import {
  OXLINT_WORKER_OLD_SPACE_MB_PER_NATIVE_THREAD,
  OXLINT_WORKER_TIERING_FLAGS_MIN_NODE_MAJOR,
  OXLINT_WORKER_TURBOFAN_INVOCATION_COUNT,
} from "../constants.js";

export interface BuildOxlintWorkerNodeArgumentsInput {
  readonly childNodeVersion: string;
  readonly nativeThreadCount: number;
}

const NODE_VERSION_PATTERN = /^v(\d+)\./;

const supportsTieringFlags = (childNodeVersion: string): boolean => {
  const match = NODE_VERSION_PATTERN.exec(childNodeVersion);
  return match !== null && Number(match[1]) >= OXLINT_WORKER_TIERING_FLAGS_MIN_NODE_MAJOR;
};

export const buildOxlintWorkerNodeArguments = ({
  childNodeVersion,
  nativeThreadCount,
}: BuildOxlintWorkerNodeArgumentsInput): string[] => [
  `--max-old-space-size=${nativeThreadCount * OXLINT_WORKER_OLD_SPACE_MB_PER_NATIVE_THREAD}`,
  ...(supportsTieringFlags(childNodeVersion)
    ? [`--invocation-count-for-turbofan=${OXLINT_WORKER_TURBOFAN_INVOCATION_COUNT}`]
    : []),
];
