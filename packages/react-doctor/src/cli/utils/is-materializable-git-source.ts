const GIT_LFS_POINTER_HEADER = "version https://git-lfs.github.com/spec/v1";

export const isMaterializableGitSource = (content: string): boolean =>
  !content.includes("\0") && !content.startsWith(GIT_LFS_POINTER_HEADER);
