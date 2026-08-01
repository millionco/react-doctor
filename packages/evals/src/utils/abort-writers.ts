export interface AbortableWriter {
  abort: () => Promise<void>;
}

export const abortWriters = async (
  writers: ReadonlyArray<AbortableWriter>,
): Promise<ReadonlyArray<unknown>> => {
  const firstResults = await Promise.allSettled(writers.map((writer) => writer.abort()));
  const failedEntries = firstResults.flatMap((result, writerIndex) =>
    result.status === "rejected" ? [{ writer: writers[writerIndex], error: result.reason }] : [],
  );
  const retryResults = await Promise.allSettled(failedEntries.map(({ writer }) => writer.abort()));
  return retryResults.flatMap((result, resultIndex) =>
    result.status === "rejected"
      ? [
          new AggregateError(
            [failedEntries[resultIndex].error, result.reason],
            "Failed to abort a matrix artifact writer",
          ),
        ]
      : [],
  );
};
