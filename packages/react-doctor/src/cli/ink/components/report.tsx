import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { GITHUB_ACTIONS_SETUP_URL } from "@react-doctor/core";
import type { ScoreResult } from "@react-doctor/core";
import { buildHandoffPayload } from "../../utils/build-handoff-payload.js";
import { METRIC } from "../../utils/constants.js";
import type { CliAgentId } from "../../utils/launch-agent.js";
import { openUrl } from "../../utils/open-url.js";
import { isOnboardingForced, shouldRecordOnboarding } from "../../utils/onboarding-pacing.js";
import { markOnboardingComplete } from "../../utils/onboarding-state.js";
import { recordCount } from "../../utils/record-metric.js";
import { useReportReveal } from "../hooks/use-report-reveal.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticRows } from "../lib/diagnostic-rows.js";
import { resolveReportLayout } from "../lib/resolve-report-layout.js";
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
const LANDING_SCREEN = "landing";
const ISSUES_SCREEN = "issues";
const CI_SCREEN = "ci";
const HANDOFF_CI_SCREEN = "handoff-ci";
const HANDOFF_SCREEN = "handoff";

type ReportScreen =
  | typeof LANDING_SCREEN
  | typeof ISSUES_SCREEN
  | typeof CI_SCREEN
  | typeof HANDOFF_CI_SCREEN
  | typeof HANDOFF_SCREEN;

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
  const reportLayout = resolveReportLayout({
    columns,
    diagnosticRowCount: diagnosticRows.length,
    terminalRows,
  });
  const reportReveal = useReportReveal({
    issueCount: diagnosticRows.length,
    onRevealComplete: completeReportOnboarding,
  });
  const [activeReportScreen, setActiveReportScreen] = useState<ReportScreen>(LANDING_SCREEN);
  const [ciSetupFeedback, setCiSetupFeedback] = useState<CiSetupFeedback>();
  const [landingSelectedIndex, setLandingSelectedIndex] = useState(0);
  const [viewerSelectedIndex, setViewerSelectedIndex] = useState(0);
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

  const landingScoreHeader = (
    <ScoreHeader
      variant="landing"
      score={report.score}
      projectedScore={report.projectedScore}
      projectName={report.projectName}
      issueCount={report.diagnostics.length}
      noScoreMessage={report.noScoreMessage}
      width={isWide ? reportLayout.listColumnWidth : reportLayout.width}
    />
  );
  const viewerScoreHeader = (
    <ScoreHeader
      variant="viewer"
      score={report.score}
      projectedScore={report.projectedScore}
      projectName={report.projectName}
      issueCount={report.diagnostics.length}
      noScoreMessage={report.noScoreMessage}
      width={isWide ? reportLayout.listColumnWidth : reportLayout.width}
    />
  );

  const isCiSetupAvailable = Boolean(canAddToCi && onAddToCi && !isCiSetupQueued);
  const isHandoffAvailable =
    diagnosticRows.length > 0 && launchableAgents.length > 0 && Boolean(onHandoff);
  const issueLabel = diagnosticRows.length === 1 ? "issue" : "issues";
  const markViewerRuleRead = (index: number): void => {
    const ruleKey = diagnosticRows[index]?.ruleKey;
    if (!ruleKey) return;
    setViewerReadRuleKeys((previous) =>
      previous.has(ruleKey) ? previous : new Set(previous).add(ruleKey),
    );
  };
  const handleViewerSelectionChange = (index: number): void => {
    setViewerSelectedIndex(index);
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
      label: `Review ${diagnosticRows.length} ${issueLabel}`,
      onSelect: () => {
        recordReportAction("view-issues");
        markViewerRuleRead(viewerSelectedIndex);
        openReportScreen(ISSUES_SCREEN);
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
        openReportScreen(CI_SCREEN);
      },
    });
  }
  if (isHandoffAvailable) {
    landingActions.push({
      id: "handoff",
      label: "Hand off to an agent",
      onSelect: () => {
        recordReportAction("handoff");
        openReportScreen(isCiSetupAvailable ? HANDOFF_CI_SCREEN : HANDOFF_SCREEN);
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
  if (activeReportScreen === CI_SCREEN) {
    activeScreenContent = (
      <CiSetup
        feedback={ciSetupFeedback}
        onConfirm={() => {
          onAddToCi?.();
          onExit();
        }}
        onLearnMore={() => {
          recordReportAction("ci-learn-more");
          const didOpen = openUrl(GITHUB_ACTIONS_SETUP_URL);
          setCiSetupFeedback({
            didSucceed: didOpen,
            message: didOpen
              ? "✓ Opened the GitHub Actions guide in your browser"
              : `Couldn't open a browser. Visit ${GITHUB_ACTIONS_SETUP_URL}`,
          });
        }}
        onBack={() => {
          setCiSetupFeedback(undefined);
          setActiveReportScreen(LANDING_SCREEN);
        }}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === HANDOFF_SCREEN) {
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
              shouldSetUpCiFirst: isCiSetupAvailable,
            }),
          });
          onExit();
        }}
        onBack={() => setActiveReportScreen(LANDING_SCREEN)}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === HANDOFF_CI_SCREEN) {
    activeScreenContent = (
      <HandoffCiRecommendation
        onAddToCi={() => {
          onAddToCi?.();
          setIsCiSetupQueued(true);
          setActiveReportScreen(HANDOFF_SCREEN);
        }}
        onContinue={() => setActiveReportScreen(HANDOFF_SCREEN)}
        onQuit={onQuit}
      />
    );
  } else if (activeReportScreen === LANDING_SCREEN) {
    activeScreenContent = (
      <ReportLanding
        header={landingScoreHeader}
        phase={reportReveal.phase}
        issueCount={report.diagnostics.length}
        emptyStateMessage={report.emptyStateMessage}
        lintFailureReason={report.lintFailureReason}
        actions={landingActions}
        selectedIndex={resolvedLandingSelectedIndex}
        onSelectionChange={setLandingSelectedIndex}
        onQuit={onQuit}
      />
    );
  } else {
    activeScreenContent = (
      <DiagnosticList
        header={reportLayout.showsViewerScoreHeader ? viewerScoreHeader : null}
        rows={diagnosticRows}
        width={reportLayout.width}
        listColumnWidth={reportLayout.listColumnWidth}
        detailColumnWidth={reportLayout.detailColumnWidth}
        listHeight={reportLayout.listHeight}
        detailHeight={reportLayout.detailHeight}
        layout={reportLayout.layout}
        rootDirectory={report.rootDirectory}
        projectName={report.projectName}
        projectCount={projectCount}
        initialSelectedIndex={viewerSelectedIndex}
        readRuleKeys={viewerReadRuleKeys}
        onSelectedIndexChange={handleViewerSelectionChange}
        onQuit={onQuit}
        onBack={() => {
          setLandingSelectedIndex(Math.max(0, postReviewLandingActionIndex));
          setActiveReportScreen(LANDING_SCREEN);
        }}
        exitHint={`esc back · ${exitHint}`}
      />
    );
  }

  return (
    <>
      {activeReportScreen === LANDING_SCREEN && shouldShowIssueStream ? issueStream : null}
      {activeScreenContent}
    </>
  );
};
