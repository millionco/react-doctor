export const expandTransitiveDependencies = (
  seedNames: ReadonlySet<string>,
  dependencyGraph: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> => {
  const reachable = new Set(seedNames);
  const queue: string[] = Array.from(seedNames);
  while (queue.length > 0) {
    const currentName = queue.pop();
    if (currentName === undefined) continue;
    const dependencyNames = dependencyGraph.get(currentName);
    if (!dependencyNames) continue;
    for (const dependencyName of dependencyNames) {
      if (reachable.has(dependencyName)) continue;
      reachable.add(dependencyName);
      queue.push(dependencyName);
    }
  }
  return reachable;
};
