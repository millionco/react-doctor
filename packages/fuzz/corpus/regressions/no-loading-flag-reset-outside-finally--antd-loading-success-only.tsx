// rule: no-loading-flag-reset-outside-finally
// verdict: fail
// weakness: control-flow
// source: independently synthetic AntD loading UI role boundary
import { useState } from "react";
import { Button } from "antd";
import { runTask } from "./task-service";
export const ActionPanel = () => {
  const [active, changeActive] = useState(false);
  const submit = async () => {
    changeActive(true);
    try {
      await runTask();
      changeActive(false);
    } catch {
      console.error("Task failed");
    }
  };
  return (
    <Button loading={active} onClick={submit}>
      Run
    </Button>
  );
};
