interface ListenerCancellationAnalysis {
  readonly abortedControllerSymbolIds: ReadonlySet<number>;
  readonly exhaustiveBranches: ReadonlyArray<ListenerCancellationBranches>;
}

interface ListenerCancellationBranches {
  readonly alternate: ListenerCancellationAnalysis;
  readonly consequent: ListenerCancellationAnalysis;
}

export const doesListenerAnalysisAbortController = (
  analysis: ListenerCancellationAnalysis,
  controllerSymbolId: number,
): boolean =>
  analysis.abortedControllerSymbolIds.has(controllerSymbolId) ||
  analysis.exhaustiveBranches.some(
    ({ alternate, consequent }) =>
      doesListenerAnalysisAbortController(alternate, controllerSymbolId) &&
      doesListenerAnalysisAbortController(consequent, controllerSymbolId),
  );
