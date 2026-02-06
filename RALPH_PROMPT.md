# Ralph Loop: Complete All Beads

You are iterating through beads issues for the llm-council project. Each iteration, pick up where you left off.

## State Tracking

Check `docs/plans/beads-completion-plan.md` for the current plan. This file is your source of truth.

## Per-Iteration Protocol

### 1. Orient

```bash
bd list --status=open          # What's left?
bd list --status=in_progress   # Am I mid-task?
cat docs/plans/beads-completion-plan.md  # What's the plan?
```

If `docs/plans/beads-completion-plan.md` does not exist, create it first (see "Planning" below).

If an issue is `in_progress`, resume it. Otherwise pick the next ready issue by priority (P1 first, then P2, then P3).

### 2. Planning

The plan file (`docs/plans/beads-completion-plan.md`) tracks every bead with:

```markdown
## council-XXX: Title
**Status:** pending | in_progress | done | skipped
**Branch:** fix/council-XXX-short-name
**Approach:** 1-3 sentences on what to do
**Alternatives considered:** Brief notes on other approaches
**PR:** (link when created)
**Notes:** (anything learned during execution)
```

When creating the plan for the first time:
- Read each open bead (`bd show <id>`) to understand the full scope
- Group related beads that should be done together
- For each bead, document the approach and alternatives
- Commit the plan file

When a bead fails or the plan is wrong:
- Update the bead's status to `pending` and add notes explaining what went wrong
- Update the approach based on what you learned
- Mark `**Status:** needs-review` so you re-evaluate next iteration
- Continue to the next bead, do NOT get stuck retrying

### 3. Execute (One Bead Per Iteration)

For each bead:

**a) Set up worktree:**
```bash
git worktree add .worktrees/council-XXX -b fix/council-XXX-short-name
cd .worktrees/council-XXX
```

Install deps if needed (check for package.json, pyproject.toml).

**b) Claim the bead:**
```bash
bd update council-XXX --status=in_progress
```

**c) Implement the fix:**
- Read the relevant source files
- Make the minimal change that addresses the bead
- Write or update tests where applicable
- Make meaningful commits with conventional commit format

**d) Verify:**
- Run relevant tests (backend: `cd backend && uv run pytest`, frontend: `cd frontend && npm test`)
- If tests fail, try to fix. If you can't fix in a reasonable effort, update the plan and move on

**e) Create PR:**
```bash
cd .worktrees/council-XXX
git push -u origin fix/council-XXX-short-name
gh pr create --title "fix(scope): short description" --body "$(cat <<'EOF'
## Summary
- What changed and why

Closes council-XXX

## Test Plan
- [ ] Tests pass
- [ ] Manual verification

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**f) Record the PR link in the plan:**
Update `docs/plans/beads-completion-plan.md` with the PR URL.

**g) Close the bead:**
```bash
bd close council-XXX --reason="PR #N created"
```

**h) Clean up worktree:**
```bash
cd /Users/cameron/Projects/llm-council
git worktree remove .worktrees/council-XXX
```

**i) Return to main and sync:**
```bash
cd /Users/cameron/Projects/llm-council
bd sync
```

### 4. Handle Failures

If implementation fails or the approach is wrong:
- Do NOT force it. Revert changes in the worktree
- Update the plan file with what went wrong and a revised approach
- Set the bead back: `bd update council-XXX --status=open`
- Mark the plan entry as `**Status:** needs-review`
- Clean up the worktree
- Move to the next bead

### 5. Completion Check

After closing a bead, check:

```bash
bd list --status=open
```

If there are open beads remaining, continue to the next one.

If ALL beads are closed (none open, none in_progress):

<promise>ALL_DONE</promise>

## Rules

- ONE bead per iteration. Do not try to batch multiple beads
- Each bead gets its own worktree and branch
- Make the best decision, document alternatives in the plan
- Commit early, commit often, with conventional commits
- If stuck, update the plan and move on. Do NOT spin
- Always return to `/Users/cameron/Projects/llm-council` (main worktree) before finishing an iteration
- Always `bd sync` before finishing an iteration
- The plan file lives in the MAIN worktree, not in feature worktrees
