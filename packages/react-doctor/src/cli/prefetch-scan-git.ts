import { buildGitSourceListingRequest, prefetchGitCommand } from "@react-doctor/core/git-prefetch";
import { RUN_GIT_MAX_BUFFER_BYTES, SCAN_RESULT_CACHE_GIT_ARGUMENTS } from "./utils/constants.js";
import { isCacheGloballyDisabled } from "./utils/is-cache-globally-disabled.js";
import { resolvePrefetchScanDirectory } from "./utils/resolve-prefetch-scan-directory.js";

// Evaluated before the rest of the CLI bundle (it is the first import of the
// entry) so git lists the project and resolves the cache identity while the
// bundle is still loading, instead of after it.
const prefetchDirectory = resolvePrefetchScanDirectory(process.argv.slice(2), process.cwd());
if (prefetchDirectory !== null) {
  prefetchGitCommand(buildGitSourceListingRequest(prefetchDirectory));
  if (!isCacheGloballyDisabled() && !process.argv.includes("--no-cache")) {
    for (const args of SCAN_RESULT_CACHE_GIT_ARGUMENTS) {
      prefetchGitCommand({
        directory: prefetchDirectory,
        args,
        maxBufferBytes: RUN_GIT_MAX_BUFFER_BYTES,
      });
    }
  }
}
