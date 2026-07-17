// rule: no-array-find-result-member-access-without-guard
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (task list: the conditional-render guard uses the optional-chained spelling of the same find)
export const TaskItem = ({
  task,
  apps,
}: {
  task: { metadata?: { app?: string } };
  apps?: { id: string; name: string }[];
}) => (
  <div>
    {task.metadata?.app && apps?.find((a) => a.id === task.metadata.app)?.name && (
      <span title={task.metadata.app}>{apps.find((a) => a.id === task.metadata.app).name}</span>
    )}
  </div>
);
