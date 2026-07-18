import type { CorpusRepository, CorpusRepositoryGroup } from "./corpus.js";

interface MutableCorpusRepositoryGroup {
  org: string;
  name: string;
  ref: string;
  rootDirectories: Set<string>;
}

export const groupCorpusRepositories = (
  repositories: ReadonlyArray<CorpusRepository>,
): ReadonlyArray<CorpusRepositoryGroup> => {
  const groupsByRepository = new Map<string, MutableCorpusRepositoryGroup>();
  for (const repository of repositories) {
    const key = `${repository.org}\0${repository.name}\0${repository.ref}`;
    const existingGroup = groupsByRepository.get(key);
    if (existingGroup) {
      existingGroup.rootDirectories.add(repository.rootDir);
      continue;
    }
    groupsByRepository.set(key, {
      org: repository.org,
      name: repository.name,
      ref: repository.ref,
      rootDirectories: new Set([repository.rootDir]),
    });
  }
  return Array.from(groupsByRepository.values(), (group) => ({
    org: group.org,
    name: group.name,
    ref: group.ref,
    rootDirectories: Array.from(group.rootDirectories),
  }));
};
