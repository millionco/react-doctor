import {
  type DeslopError,
  type DeslopErrorModule,
  DetectorError,
  describeUnknownError,
} from "../errors.js";

export interface RunSafeDetectorInput<ResultType> {
  detectorName: string;
  detector: () => ResultType;
  fallback: ResultType;
  errorSink: DeslopError[];
  module: DeslopErrorModule;
  contextDescription: string;
}

export const runSafeDetector = <ResultType>(
  input: RunSafeDetectorInput<ResultType>,
): ResultType => {
  try {
    return input.detector();
  } catch (caughtError) {
    input.errorSink.push(
      new DetectorError({
        module: input.module,
        message: `${input.detectorName} threw ${input.contextDescription}`,
        detail: describeUnknownError(caughtError),
      }),
    );
    return input.fallback;
  }
};
