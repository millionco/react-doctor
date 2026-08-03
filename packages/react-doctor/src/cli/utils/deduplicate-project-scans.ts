interface ProjectScanDirectory {
  readonly directory: string;
}

export const deduplicateProjectScans = <ProjectScan extends ProjectScanDirectory>(
  projectScans: ReadonlyArray<ProjectScan>,
): ProjectScan[] => {
  const uniqueProjectScans: ProjectScan[] = [];
  const seenDirectories = new Set<string>();
  for (const projectScan of projectScans) {
    if (seenDirectories.has(projectScan.directory)) continue;
    seenDirectories.add(projectScan.directory);
    uniqueProjectScans.push(projectScan);
  }
  return uniqueProjectScans;
};
