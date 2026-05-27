---
name: review-comment-triager
description: Triage bot and human review comments on React Doctor rule PRs. Use when evaluating Copilot, Bugbot, Devin, maintainer, or reviewer feedback and deciding whether to fix, defer, reject, or add tests.
---

# Review Comment Triager

Use this after PR review comments arrive.

## Classify Each Comment

Fix now:

- Real false positive.
- Real false negative for claimed behavior.
- Incorrect AST semantics.
- Scope or binding bug.
- Control-flow bug with a reasonable reproducer.

Usually fix:

- Duplicated helper.
- Misleading name.
- Unnecessary abstraction.
- Confusing comment.

Document or defer:

- False-negative coverage outside v1 scope.
- Path explosion in pathological code.
- Complex loop/try/catch modeling when current behavior is conservative.
- Imported file analysis.

Reject:

- Comment broadens the rule beyond its message.
- Suggestion increases false positives.
- Style preference conflicts with repo conventions.

## Output

For each comment, return:

- Classification
- Reason
- Required code change, if any
- Required regression test, if any
- Suggested response or resolution note

## Reference

For real examples from rule PR reviews, read `examples.md`.
