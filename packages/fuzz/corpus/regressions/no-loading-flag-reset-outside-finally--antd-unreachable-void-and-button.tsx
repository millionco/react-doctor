// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: independent synthetic AntD loading role review
// verdict: pass
import { useState } from "react";
import { Button } from "antd";
import { performTask } from "./task-provider";
export const TaskPanel = () => {
  const [phase, changePhase] = useState(false);
  const [message, changeMessage] = useState("");
  const submit = async () => {
    changePhase(true);
    try {
      await performTask();
      changePhase(false);
    } catch {
      changeMessage("Failed");
    }
  };
  return (
    void 0 && (
      <Button loading={phase} onClick={submit}>
        Run
      </Button>
    )
  );
};
