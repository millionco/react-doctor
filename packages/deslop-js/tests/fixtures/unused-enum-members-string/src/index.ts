import { Status } from "./status.js";

export const isLive = (currentStatus: Status): boolean => currentStatus === Status.Active;

export const renderPending = (currentStatus: Status): string =>
  currentStatus === Status.Pending ? "..." : "done";

console.log(isLive(Status.Active), renderPending(Status.Pending));
