// rule: no-loading-flag-reset-outside-finally
// weakness: alias-guard
// source: independent synthetic AntD loading role review
// verdict: fail
import { useState } from "react";
import { Button } from "antd";
import { performTask } from "./task-provider";
export const TaskPanel = () => {
  const [phase, changePhase] = useState(false);
  interface changePhase {}
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
    <Button loading={phase} onClick={submit}>
      Run
    </Button>
  );
};
