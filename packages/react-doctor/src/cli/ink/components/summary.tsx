import type { CliAgentId } from "../../utils/launch-agent.js";
import type { MultiProjectSummary, ScanReport, TuiHandoffRequest } from "../scan-store.js";
import { Report } from "./report.js";

export interface SummaryProps {
  readonly summary: MultiProjectSummary;
  readonly onExit: () => void;
  readonly onQuit: () => void;
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
}

export const Summary = ({
  summary,
  onExit,
  onQuit,
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
}: SummaryProps) => {
  const report: ScanReport = {
    diagnostics: summary.combinedDiagnostics,
    score: summary.aggregateScore,
    projectedScore: summary.projectedScore,
    projectName: summary.projectName,
    rootDirectory: summary.rootDirectory,
    scannedFileCount: summary.scannedFileCount,
    elapsedMilliseconds: summary.elapsedMilliseconds,
    isOffline: summary.isOffline,
    noScoreMessage: summary.noScoreMessage,
    skippedChecks: [...new Set(summary.projects.flatMap((project) => project.skippedChecks ?? []))],
    ...(summary.emptyStateMessage ? { emptyStateMessage: summary.emptyStateMessage } : {}),
    ...(summary.lintFailureReason ? { lintFailureReason: summary.lintFailureReason } : {}),
  };
  return (
    <Report
      report={report}
      onExit={onExit}
      onQuit={onQuit}
      launchableAgents={launchableAgents}
      onHandoff={onHandoff}
      canAddToCi={canAddToCi}
      onAddToCi={onAddToCi}
      projectCount={summary.projects.length}
      priorityScores={summary.projects.map((project) => project.score)}
    />
  );
};
