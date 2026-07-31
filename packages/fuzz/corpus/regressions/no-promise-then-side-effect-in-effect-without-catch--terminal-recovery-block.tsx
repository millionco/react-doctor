// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: control-flow
// source: ReactBench fix-react-rdh-sofn-xyz-mailing-s__fJkiZQQ
import { useEffect, useRef, useState } from "react";

export const ApiKeys = ({ updateAlert }) => {
  const [tasks, setTasks] = useState([]);
  const [, setApiKeys] = useState([]);
  const latestSuccessfulRefreshIdRef = useRef(0);

  useEffect(() => {
    const refreshId = 1;
    const triggerIds = [1];
    fetch("/api/apiKeys")
      .then((response) => response.json())
      .then((json) => {
        setTasks((previous) => previous.map((task) => ({ ...task, status: "success" })));
        if (refreshId > latestSuccessfulRefreshIdRef.current) {
          latestSuccessfulRefreshIdRef.current = refreshId;
          setApiKeys(json.apiKeys);
        }
        updateAlert(Math.max(...triggerIds), false);
      })
      .catch(() => {
        setTasks((previous) => previous.map((task) => ({ ...task, status: "error" })));
        updateAlert(Math.max(...triggerIds), true);
      });
  }, [tasks, updateAlert]);

  return null;
};
