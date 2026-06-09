export type PillStatus = "success" | "error" | "warning" | "info";

export interface StatusPillProps {
  status: PillStatus;
}

const STATUS_LABEL: Record<PillStatus, string> = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export const StatusPill = ({ status }: StatusPillProps) => (
  <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>
);
