---
name: ship
description: Take the current branch from done-coding to merge-ready in one pass — review the diff against AGENTS.md, deslop, commit and push, open a PR using rule-validate's PR copy, then babysit until mergeable. Use when the user types `/ship` or asks to ship, finalize, or land the current branch.
disable-model-invocation: true
---

# Ship

Sequential release pipeline for the current branch. Run only when explicitly invoked — it commits, pushes, and opens a PR.

Each stage delegates to an existing skill. Run them in order and do not advance while a stage still has unresolved findings.

Copy this checklist and track progress:

```
Ship progress:
- [ ] 1. Review the diff against AGENTS.md
- [ ] 2. Deslop the touched code
- [ ] 3. Commit and push
- [ ] 4. Open the PR
- [ ] 5. Babysit to merge-ready
```

## 1. Review against AGENTS.md

Read `AGENTS.md` first (its rules change), then run `/review` on this branch's diff, judging it against those rules. Fix real violations before continuing. Pause for the user only if a fix would change behavior or broaden scope.

## 2. Deslop

Run `/deslop` ([`../deslop/SKILL.md`](../deslop/SKILL.md)) to simplify the recently modified code while preserving functionality, including its `truffler` duplicate-consolidation pass. Apply the refinements before committing.

## 3. Commit and push

- Stage only the intended changes; never commit secrets.
- Add a changeset first when a published package's behavior changed (follow the **Changeset** section of `/rule-validate`); skip only for private/docs/test/tooling-only changes and note why.
- Run the repo checks that fit the change before committing: `nr test`, `nr lint`, `nr typecheck`, `nr format:check`.
- Write a concise commit message in the repo's style, focused on the why.
- Push the branch, setting upstream with `-u` on the first push.
- Git safety: no force-push to `main`, no skipped hooks, no `git config` changes.

## 4. Open the PR

Create the PR with `gh pr create`, writing the body with the **PR Description** structure from `/rule-validate` ([`../rule-validate/SKILL.md`](../rule-validate/SKILL.md)): Why (with before/after), What changed, Eval results (omit the table if RDE was not run), Test plan. Pass the body via a heredoc. Return the PR URL.

## 5. Babysit

Run `/babysit` to drive the PR to merge-ready: resolve merge conflicts preserving intent, triage unresolved comments (including Bugbot), and fix in-scope CI in a loop until the PR is mergeable, green, and its comments are triaged. Report back instead of merging.

## Stop conditions

Pause and ask the user when:

- Review or babysit surfaces a change that would broaden scope or alter intended behavior.
- A merge conflict has genuinely conflicting intent on the two branches.
- CI fails for reasons outside this branch's scope even after merging the latest base.
