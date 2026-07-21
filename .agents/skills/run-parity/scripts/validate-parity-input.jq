def is_string_array:
  type == "array" and all(.[]; type == "string");

def is_nonnegative_number:
  type == "number" and . >= 0;

def is_nonnegative_integer:
  is_nonnegative_number and floor == .;

def is_string_record:
  type == "object" and all(.[]; type == "string");

def is_diagnostic($schema_version):
  type == "object" and
  (.filePath | type) == "string" and
  (.line | is_nonnegative_number) and
  (.column | is_nonnegative_number) and
  (.plugin | type) == "string" and
  (.rule | type) == "string" and
  (.severity == "error" or .severity == "warning") and
  (.message | type) == "string" and
  (.help | type) == "string" and
  (.category | type) == "string" and
  (
    $schema_version != 3 or
    (
      (.id | type) == "string" and
      (.normalizedFilePath | type) == "string" and
      (.tags | is_string_array)
    )
  );

def is_project($schema_version):
  type == "object" and
  (.directory | type) == "string" and
  (.diagnostics | type) == "array" and
  all(.diagnostics[]; is_diagnostic($schema_version)) and
  (.skippedChecks | is_string_array) and
  (has("project")) and
  (has("score")) and
  ((has("skippedCheckReasons") | not) or (.skippedCheckReasons | is_string_record)) and
  ((has("scannedFileCount") | not) or (.scannedFileCount | is_nonnegative_integer)) and
  (.elapsedMilliseconds | is_nonnegative_number) and
  (
    if $schema_version == 3 then
      (.packageRoot | type) == "string" and
      (.framework as $framework | ["nextjs", "vite", "cra", "remix", "gatsby", "expo", "react-native", "tanstack-start", "preact", "unknown"] | index($framework)) != null and
      .complete == true and
      (.skippedChecks | length) == 0 and
      ((.skippedCheckReasons // {}) | length) == 0 and
      (.analyzedFiles | is_string_array) and
      (.analyzedFileCount | is_nonnegative_integer) and
      .analyzedFileCount == (.analyzedFiles | length) and
      ((has("scannedFileCount") | not) or .scannedFileCount == .analyzedFileCount)
    else
      (.skippedChecks | length) == 0 and
      ((.skippedCheckReasons // {}) | length) == 0
    end
  );

def is_diff:
  . == null or
  (
    type == "object" and
    (.baseBranch | type) == "string" and
    ((.currentBranch == null) or (.currentBranch | type) == "string") and
    (.changedFileCount | is_nonnegative_integer) and
    (.isCurrentChanges | type) == "boolean"
  );

def is_baseline:
  type == "object" and
  (.baseRef | type) == "string" and
  (.newCount | is_nonnegative_integer) and
  (.fixedCount | is_nonnegative_integer) and
  (.baseTotalCount | is_nonnegative_integer);

def is_report:
  .schemaVersion as $schema_version |
  .mode as $mode |
  type == "object" and
  ([1, 2, 3] | index($schema_version)) != null and
  .ok == true and
  (.version | type) == "string" and
  (.directory | type) == "string" and
  (["full", "diff", "staged", "baseline"] | index($mode)) != null and
  (has("diff")) and
  (.diff | is_diff) and
  (($schema_version != 2) or (.baseline | is_baseline)) and
  (($schema_version != 3) or (has("baseline") | not) or (.baseline | is_baseline)) and
  (.projects | type) == "array" and
  (.projects | length) > 0 and
  all(.projects[]; is_project($schema_version)) and
  (.diagnostics | type) == "array" and
  all(.diagnostics[]; is_diagnostic($schema_version)) and
  [.projects[].diagnostics[]] == .diagnostics and
  (.summary | type) == "object" and
  .summary.errorCount == (reduce .diagnostics[] as $diagnostic (0; . + if $diagnostic.severity == "error" then 1 else 0 end)) and
  .summary.warningCount == (reduce .diagnostics[] as $diagnostic (0; . + if $diagnostic.severity == "warning" then 1 else 0 end)) and
  (.summary.affectedFileCount | is_nonnegative_integer) and
  .summary.totalDiagnosticCount == (.diagnostics | length) and
  (.summary.score == null or (.summary.score | type) == "number") and
  (.summary.scoreLabel == null or (.summary.scoreLabel | type) == "string") and
  (.elapsedMilliseconds | is_nonnegative_number) and
  .error == null;

def is_canonical_root_directory:
  type == "string" and
  length > 0 and
  (test("[\\\"'`$;&|<>\\\\\\r\\n]") | not) and
  (startswith("/") | not) and
  (. == "." or (split("/") | all(.[]; length > 0 and . != "." and . != "..")));

def is_eval_record:
  type == "object" and
  .schemaVersion == 1 and
  (.repository | type) == "object" and
  (.repository.org | type) == "string" and
  (.repository.org | test("^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$")) and
  (.repository.name | type) == "string" and
  (.repository.name | test("^[A-Za-z0-9._-]+$")) and
  (.repository.ref | type) == "string" and
  (.repository.ref | test("^[0-9A-Fa-f]{40}$")) and
  (.repository.rootDir | is_canonical_root_directory) and
  (has("error") | not) and
  (.report | is_report);

def eval_record_key:
  [.repository.org, .repository.name, .repository.ref, .repository.rootDir] | @json;

reduce inputs as $record (
  { count: 0, valid: true, seen: {} };
  ($record | eval_record_key) as $record_key |
  {
    count: (.count + 1),
    valid: (.valid and ($record | is_eval_record) and (.seen[$record_key] != true)),
    seen: (.seen + { ($record_key): true })
  }
)
| .count > 0 and .valid
