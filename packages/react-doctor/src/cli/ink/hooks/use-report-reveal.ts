import { useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import {
  TUI_REPORT_ISSUE_STREAM_FRAME_DELAY_MS,
  TUI_REPORT_ISSUE_STREAM_MAX_STEPS,
  TUI_REPORT_ISSUE_STREAM_MIN_STEPS,
  TUI_REPORT_REVEAL_STEP_INCREMENT,
} from "../../utils/constants.js";
import {
  canAnimateOnboarding,
  ONBOARDING_SECTION_DELAY_MS,
} from "../../utils/onboarding-pacing.js";

export interface ReportReveal {
  readonly phase: "actions" | "score" | "streaming";
  readonly streamSelectedIndex: number;
}

export interface UseReportRevealInput {
  readonly issueCount: number;
  readonly onRevealComplete?: () => void;
}

export const useReportReveal = ({
  issueCount,
  onRevealComplete,
}: UseReportRevealInput): ReportReveal => {
  const { stdout } = useStdout();
  const shouldAnimate = issueCount > 0 && canAnimateOnboarding(stdout ?? undefined);
  const streamStepCount = Math.min(
    TUI_REPORT_ISSUE_STREAM_MAX_STEPS,
    Math.max(issueCount, TUI_REPORT_ISSUE_STREAM_MIN_STEPS),
  );
  const [streamStep, setStreamStep] = useState(0);
  const [didRevealActions, setDidRevealActions] = useState(false);
  const didNotifyRevealComplete = useRef(false);
  const isStreaming = shouldAnimate && streamStep < streamStepCount;
  const didReachActions = shouldAnimate ? didRevealActions : stdout?.isTTY === true;

  useEffect(() => {
    if (!shouldAnimate) return;

    let nextStreamStep = 0;
    const intervalId = setInterval(() => {
      nextStreamStep = Math.min(streamStepCount, nextStreamStep + TUI_REPORT_REVEAL_STEP_INCREMENT);
      setStreamStep(nextStreamStep);
      if (nextStreamStep === streamStepCount) clearInterval(intervalId);
    }, TUI_REPORT_ISSUE_STREAM_FRAME_DELAY_MS);
    return () => clearInterval(intervalId);
  }, [shouldAnimate, streamStepCount]);

  useEffect(() => {
    if (!shouldAnimate || isStreaming) return;

    const timeoutId = setTimeout(() => setDidRevealActions(true), ONBOARDING_SECTION_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [isStreaming, shouldAnimate]);

  useEffect(() => {
    if (!didReachActions || didNotifyRevealComplete.current) return;
    didNotifyRevealComplete.current = true;
    onRevealComplete?.();
  }, [didReachActions, onRevealComplete]);

  if (!shouldAnimate) {
    return { phase: "actions", streamSelectedIndex: 0 };
  }
  if (isStreaming) {
    return {
      phase: "streaming",
      streamSelectedIndex: streamStep % issueCount,
    };
  }
  return { phase: didRevealActions ? "actions" : "score", streamSelectedIndex: 0 };
};
