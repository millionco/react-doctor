import { useApp } from "ink";
import { TUI_RECENT_LIVE_DIAGNOSTIC_COUNT } from "../utils/constants.js";
import type { CliAgentId } from "../utils/launch-agent.js";
import { Report } from "./components/report.js";
import { Scanning } from "./components/scanning.js";
import { Summary } from "./components/summary.js";
import { useExitOnCtrlC } from "./hooks/use-exit-on-ctrl-c.js";
import { useScanStore } from "./hooks/use-scan-store.js";
import type { ScanStore, TuiHandoffRequest } from "./scan-store.js";

export interface ScanAppProps {
  readonly store: ScanStore;
  readonly displayMode?: "scan" | "report";
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
  readonly onQuit?: () => void;
}

export const ScanApp = ({
  store,
  displayMode = "report",
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
  onQuit,
}: ScanAppProps) => {
  const snapshot = useScanStore(store);
  const { exit } = useApp();
  useExitOnCtrlC();
  const handleQuit = (): void => {
    onQuit?.();
    exit();
  };

  if (displayMode === "report" && snapshot.phase === "summary" && snapshot.summary) {
    return (
      <Summary
        summary={snapshot.summary}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={exit}
        onQuit={handleQuit}
      />
    );
  }

  if (displayMode === "report" && snapshot.phase === "report" && snapshot.report) {
    return (
      <Report
        report={snapshot.report}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={exit}
        onQuit={handleQuit}
      />
    );
  }

  return (
    <Scanning
      progressText={snapshot.progress}
      recent={snapshot.liveDiagnostics.slice(-TUI_RECENT_LIVE_DIAGNOSTIC_COUNT)}
    />
  );
};
