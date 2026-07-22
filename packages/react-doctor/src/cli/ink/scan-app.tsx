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
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
}

export const ScanApp = ({
  store,
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
}: ScanAppProps) => {
  const snapshot = useScanStore(store);
  const { exit } = useApp();
  useExitOnCtrlC();

  if (snapshot.phase === "summary" && snapshot.summary) {
    return (
      <Summary
        summary={snapshot.summary}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={() => exit()}
      />
    );
  }

  if (snapshot.phase === "report" && snapshot.report) {
    return (
      <Report
        report={snapshot.report}
        launchableAgents={launchableAgents}
        onHandoff={onHandoff}
        canAddToCi={canAddToCi}
        onAddToCi={onAddToCi}
        onExit={() => exit()}
      />
    );
  }

  return (
    <Scanning
      progressText={snapshot.progress}
      liveCount={snapshot.liveCount}
      recent={snapshot.liveDiagnostics.slice(-TUI_RECENT_LIVE_DIAGNOSTIC_COUNT)}
    />
  );
};
