import { Text } from "ink";
import { render } from "ink-testing-library";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  TUI_DEFAULT_TERMINAL_COLUMNS,
  TUI_REPORT_ISSUE_STREAM_FRAME_DELAY_MS,
  TUI_REPORT_ISSUE_STREAM_MAX_STEPS,
} from "../../src/cli/utils/constants.js";
import {
  FORCE_ONBOARDING_ENV_VAR,
  ONBOARDING_SECTION_DELAY_MS,
} from "../../src/cli/utils/onboarding-pacing.js";
import { useReportReveal } from "../../src/cli/ink/hooks/use-report-reveal.js";

const previousForceOnboarding = process.env[FORCE_ONBOARDING_ENV_VAR];
const previousTerminalName = process.env.TERM;

interface RevealProbeProps {
  readonly issueCount: number;
  readonly onRevealComplete: () => void;
}

const RevealProbe = ({ issueCount, onRevealComplete }: RevealProbeProps) => {
  const reveal = useReportReveal({ issueCount, onRevealComplete });
  return <Text>{reveal.phase}</Text>;
};

afterEach(() => {
  vi.useRealTimers();
  if (previousForceOnboarding === undefined) delete process.env[FORCE_ONBOARDING_ENV_VAR];
  else process.env[FORCE_ONBOARDING_ENV_VAR] = previousForceOnboarding;
  if (previousTerminalName === undefined) delete process.env.TERM;
  else process.env.TERM = previousTerminalName;
  vi.restoreAllMocks();
});

describe("useReportReveal", () => {
  it("completes onboarding only after the animated report reveal", async () => {
    vi.useFakeTimers();
    process.env[FORCE_ONBOARDING_ENV_VAR] = "1";
    process.env.TERM = "xterm-256color";
    const onRevealComplete = vi.fn();
    const renderedView = render(<RevealProbe issueCount={2} onRevealComplete={onRevealComplete} />);
    Object.defineProperty(renderedView.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(renderedView.stdout, "columns", {
      value: TUI_DEFAULT_TERMINAL_COLUMNS,
      configurable: true,
    });

    renderedView.rerender(<RevealProbe issueCount={2} onRevealComplete={onRevealComplete} />);

    expect(renderedView.lastFrame()).toContain("streaming");
    expect(onRevealComplete).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        TUI_REPORT_ISSUE_STREAM_FRAME_DELAY_MS * TUI_REPORT_ISSUE_STREAM_MAX_STEPS,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ONBOARDING_SECTION_DELAY_MS);
    });
    expect(onRevealComplete).toHaveBeenCalledOnce();
    expect(renderedView.lastFrame()).toContain("actions");
    renderedView.unmount();
  });

  it("completes onboarding when a clean interactive report opens on its actions", async () => {
    process.env.TERM = "xterm-256color";
    const onRevealComplete = vi.fn();
    const renderedView = render(<RevealProbe issueCount={0} onRevealComplete={onRevealComplete} />);
    Object.defineProperty(renderedView.stdout, "isTTY", { value: true, configurable: true });

    renderedView.rerender(<RevealProbe issueCount={0} onRevealComplete={onRevealComplete} />);

    await vi.waitFor(() => expect(onRevealComplete).toHaveBeenCalledOnce());
    expect(renderedView.lastFrame()).toContain("actions");
    renderedView.unmount();
  });
});
