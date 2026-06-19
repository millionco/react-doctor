// Random bytes used to mint a session id; 3 bytes renders as a 6-char hex string.
export const SESSION_ID_BYTE_LENGTH = 3;

// How long to wait for an existing server to answer a health ping before we
// treat its lock file as stale and take the port for ourselves.
export const LOCK_PING_TIMEOUT_MS = 1000;

export const LOG_DIRECTORY_NAME = "react-doctor-debug";

// Hex chars of the project-path hash used to give each project its own log +
// lock subdirectory. 16 keeps collisions negligible without a long path.
export const PROJECT_KEY_LENGTH = 16;

// Cap on remembered entry ids for dedup. When reached, the set clears, so the
// memory stays bounded over a long session at the cost of allowing a stale
// duplicate after a wraparound.
export const MAX_DEDUP_ENTRIES = 10_000;

// Reject a POST body larger than this so a runaway/slow client can't exhaust
// memory (a single NDJSON log line is tiny).
export const MAX_REQUEST_BODY_BYTES = 1_000_000;

export const DEFAULT_HOST = "127.0.0.1";
