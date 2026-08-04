import type { ReactNode } from "react";
import { GITHUB_ACTIONS_SETUP_URL } from "@react-doctor/core";
import type { ScoreResult } from "@react-doctor/core";
import { buildHandoffPayload } from "../../utils/build-handoff-payload.js";
import { METRIC } from "../../utils/constants.js";
import type { CliAgentId } from "../../utils/launch-agent.js";
import { openUrl } from "../../utils/open-url.js";
import { isOnboardingForced, shouldRecordOnboarding } from "../../utils/onboarding-pacing.js";
import { markOnboardingComplete } from "../../utils/onboarding-state.js";
import { pluralize } from "../../utils/pluralize.js";
import { recordCount } from "../../utils/record-metric.js";
import { useReportReveal } from "../hooks/use-report-reveal.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticListEntries } from "../lib/diagnostic-list-entries.js";
import { buildDiagnosticRows } from "../lib/diagnostic-rows.js";
import { resolveReportLayout } from "../lib/resolve-report-layout.js";
import { useEffect, useMemo, useRef, useState } from "../react-runtime.js";
import type { ScanReport, TuiHandoffRequest } from "../scan-store.js";
import type { ActionMenuAction } from "./action-menu.js";
import { AgentHandoff } from "./agent-handoff.js";
import { CiJustification } from "./ci-justification.js";
import { CiSetup } from "./ci-setup.js";
import type { CiSetupFeedback } from "./ci-setup.js";
import { DiagnosticList } from "./diagnostic-list.js";
import { HandoffCiRecommendation } from "./handoff-ci-recommendation.js";
import { ReportLanding } from "./report-landing.js";
import { ReportIssueStream } from "./report-issue-stream.js";
import { ScoreHeader } from "./score-header.js";

export interface ReportProps {
  readonly report: ScanReport;
  readonly onExit: () => void;
  readonly onQuit?: () => void;
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
  readonly projectCount?: number;
  readonly priorityScores?: ReadonlyArray<ScoreResult | null>;
  readonly exitHint?: string;
}

const EMPTY_LAUNCHABLE_AGENTS: ReadonlyArray<CliAgentId> = [];

type ReportScreen = "landing" | "issues" | "ci" | "handoff-ci" | "handoff";

const recordReportAction = (action: string): void => {
  recordCount(METRIC.tuiReportActionSelected, 1, { action });
};

const completeReportOnboarding = (): void => {
  const forceOnboarding = isOnboardingForced();
  if (
    shouldRecordOnboarding({
      paceOnboardingSections: true,
      forceOnboarding,
      verbose: false,
      isNonInteractiveEnvironment: false,
    })
  ) {
    markOnboardingComplete();
  }
};

export const Report = ({
  report,
  onExit,
  onQuit = onExit,
  launchableAgents = EMPTY_LAUNCHABLE_AGENTS,
  onHandoff,
  canAddToCi,
  onAddToCi,
  projectCount,
  priorityScores,
  exitHint = "q to quit",
}: ReportProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const diagnosticRows = useMemo(
    () => buildDiagnosticRows(report.diagnostics, priorityScores ?? [report.score]),
    [report.diagnostics, report.score, priorityScores],
  );
  const diagnosticListEntries = useMemo(
    () => buildDiagnosticListEntries(diagnosticRows),
    [diagnosticRows],
  );
  const reportLayout = resolveReportLayout({
    columns,
    diagnosticEntryCount: diagnosticListEntries.length,
    terminalRows,
  });
  const reportReveal = useReportReveal({
    issueCount: diagnosticRows.length,
    onRevealComplete: completeReportOnboarding,
  });
  const [activeReportScreen, setActiveReportScreen] = useState<ReportScreen>("landing");
  const [ciSetupFeedback, setCiSetupFeedback] = useState<CiSetupFeedback>();
  const [landingSelectedIndex, setLandingSelectedIndex] = useState(0);
  const [viewerSelectedRowIndex, setViewerSelectedRowIndex] = useState<number | null>(null);
  const [viewerReadRuleKeys, setViewerReadRuleKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isCiSetupQueued, setIsCiSetupQueued] = useState(false);
  const [shouldShowIssueStream, setShouldShowIssueStream] = useState(true);
  const didRecordCompactReport = useRef(false);
  const didRecordIssueStream = useRef(false);
  const didRecordStackedReportCap = useRef(false);
  const isCompact = reportLayout.layout === "compact";
  const isWide = reportLayout.layout === "split";

  useEffect(() => {
    if (!isCompact || didRecordCompactReport.current) return;
    didRecordCompactReport.current = true;
    recordCount(METRIC.tuiCompactReportShown);
  }, [isCompact]);
  useEffect(() => {
    if (!reportLayout.isStackedReportCapped || didRecordStackedReportCap.current) return;
    didRecordStackedReportCap.current = true;
    recordCount(METRIC.tuiStackedReportCapped);
  }, [reportLayout.isStackedReportCapped]);
  useEffect(() => {
    if (reportReveal.phase !== "streaming" || didRecordIssueStream.current) return;
    didRecordIssueStream.current = true;
    recordCount(METRIC.tuiIssueStreamShown);
  }, [reportReveal.phase]);

  const scoreHeaderProps = {
    score: report.score,
    projectedScore: report.projectedScore,
    projectName: report.projectName,
    issueCount: report.diagnostics.length,
    noScoreMessage: report.noScoreMessage,
    width: isWide ? reportLayout.listColumnWidth : reportLayout.width,
  };

  const isCiSetupAvailable = Boolean(canAddToCi && onAddToCi && !isCiSetupQueued);
  const isHandoffAvailable =
    diagnosticRows.length > 0 && launchableAgents.length > 0 && Boolean(onHandoff);
  const firstDiagnosticEntry = diagnosticListEntries.find((entry) => entry.kind === "item");
  const resolvedViewerSelectedRowIndex =
    viewerSelectedRowIndex ??
    (firstDiagnosticEntry?.kind === "item" ? firstDiagnosticEntry.rowIndex : null);
  const markViewerRuleRead = (index: number): void => {
    const ruleKey = diagnosticRows[index]?.ruleKey;
    if (!ruleKey) return;
    setViewerReadRuleKeys((previous) =>
      previous.has(ruleKey) ? previous : new Set(previous).add(ruleKey),
    );
  };
  const handleViewerSelectionChange = (index: number): void => {
    setViewerSelectedRowIndex(index);
    markViewerRuleRead(index);
  };
  const openReportScreen = (nextScreen: ReportScreen): void => {
    setShouldShowIssueStream(false);
    setCiSetupFeedback(undefined);
    setActiveReportScreen(nextScreen);
  };
  const landingActions: ActionMenuAction[] = [];
  if (report.diagnostics.length > 0) {
    landingActions.push({
      id: "view-issues",
      label: `Review ${pluralize(diagnosticRows.length, "issue")}`,
      onSelect: () => {
        recordReportAction("view-issues");
        if (resolvedViewerSelectedRowIndex !== null) {
          setViewerSelectedRowIndex(resolvedViewerSelectedRowIndex);
          markViewerRuleRead(resolvedViewerSelectedRowIndex);
        }
        openReportScreen("issues");
      },
    });
  }
  if (isCiSetupAvailable) {
    landingActions.push({
      id: "add-to-ci",
      label: "Add to GitHub Actions (Recommended)",
      description: <CiJustification />,
      onSelect: () => {
        recordReportAction("add-to-ci");
        openReportScreen("ci");
      },
    });
  }
  if (isHandoffAvailable) {
    landingActions.push({
      id: "handoff",
      label: "Hand off to an agent",
      onSelect: () => {
        recordReportAction("handoff");
        openReportScreen(isCiSetupAvailable ? "handoff-ci" : "handoff");
      },
    });
  }
  const postReviewLandingActionIndex = landingActions.findIndex(
    (action) => action.id !== "view-issues",
  );
  const resolvedLandingSelectedIndex = Math.min(
    landingSelectedIndex,
    Math.max(0, landingActions.length - 1),
  );

  const issueStream =
    reportReveal.phase === "streaming" ? (
      <ReportIssueStream
        rows={diagnosticRows}
        selectedIndex={reportReveal.streamSelectedIndex}
        width={reportLayout.width}
      />
    ) : null;

  let activeScreenContent: ReactNode;
  if (activeReportScreen === "ci") {
    activeScreenContent = (
      <CiSetup
        feedback={ciSetupFeedback}
        onConfirm={() => {
          onAddToCi?.();
          onExit();
        }}
        onLearnMore={() => {
          recordReportAction("ci-learn-more");
          void openUrl(GITHUB_ACTIONS_SETUP_URL).then((didOpen) => {
            setCiSetupFeedback({
              didSucceed: didOpen,
              message: didOpen
                ? "✓ Opened the GitHub Actions guide in your browser"
                : `Couldn't open a browser. Visit ${GITHUB_ACTIONS_SETUP_URL}`,
            });
          });
        }}
        onBack={() => {
          setCiSetupFeedback(undefined);
          setActiveReportScreen("landing");
        }}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === "handoff") {
    activeScreenContent = (
      <AgentHandoff
        agents={launchableAgents}
        onSelect={(agentId) => {
          if (!onHandoff) return;
          onHandoff({
            agentId,
            prompt: buildHandoffPayload({
              diagnostics: report.diagnostics,
              projectName: report.projectName,
            }),
          });
          onExit();
        }}
        onBack={() => setActiveReportScreen("landing")}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === "handoff-ci") {
    activeScreenContent = (
      <HandoffCiRecommendation
        onAddToCi={() => {
          onAddToCi?.();
          setIsCiSetupQueued(true);
          setActiveReportScreen("handoff");
        }}
        onContinue={() => setActiveReportScreen("handoff")}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === "landing") {
    activeScreenContent = (
      <ReportLanding
        header={<ScoreHeader variant="landing" {...scoreHeaderProps} />}
        phase={reportReveal.phase}
        issueCount={report.diagnostics.length}
        emptyStateMessage={report.emptyStateMessage}
        lintFailureReason={report.lintFailureReason}
        skippedChecks={report.skippedChecks}
        incompleteMessage={report.incompleteMessage}
        actions={landingActions}
        selectedIndex={resolvedLandingSelectedIndex}
        onSelectionChange={setLandingSelectedIndex}
        onQuit={onQuit}
      />
    );
  } else {
    activeScreenContent = (
      <DiagnosticList
        header={
          reportLayout.showsViewerScoreHeader ? (
            <ScoreHeader variant="viewer" {...scoreHeaderProps} />
          ) : null
        }
        rows={diagnosticRows}
        entries={diagnosticListEntries}
        width={reportLayout.width}
        listColumnWidth={reportLayout.listColumnWidth}
        detailColumnWidth={reportLayout.detailColumnWidth}
        listHeight={reportLayout.listHeight}
        detailHeight={reportLayout.detailHeight}
        layout={reportLayout.layout}
        rootDirectory={report.rootDirectory}
        projectName={report.projectName}
        projectCount={projectCount}
        initialSelectedRowIndex={resolvedViewerSelectedRowIndex}
        readRuleKeys={viewerReadRuleKeys}
        onSelectedRowIndexChange={handleViewerSelectionChange}
        onQuit={onQuit}
        onBack={() => {
          setLandingSelectedIndex(Math.max(0, postReviewLandingActionIndex));
          setActiveReportScreen("landing");
        }}
        exitHint={`esc back · ${exitHint}`}
      />
    );
  }

  return (
    <>
      {activeReportScreen === "landing" && shouldShowIssueStream ? issueStream : null}
      {activeScreenContent}
    </>
  );
};
