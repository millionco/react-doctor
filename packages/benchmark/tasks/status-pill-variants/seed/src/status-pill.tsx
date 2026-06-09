export type PillStatus = "success" | "error" | "warning" | "info";

export interface StatusPillProps {
  status: PillStatus;
}

// TODO(agent): implement. See instruction.md.
export const StatusPill = (_props: StatusPillProps) => {
  throw new Error("not implemented");
};
