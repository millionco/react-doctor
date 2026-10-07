export const formatSkippedProjectsMessage = (projectCount: number): string =>
  `${projectCount} ${projectCount === 1 ? "project was" : "projects were"} skipped because the max scan duration was reached.`;
