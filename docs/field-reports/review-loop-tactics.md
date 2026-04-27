# Review-Loop Tactics — Field Report

**Date:** 2026-04-26
**Type:** discovery
**Project:** llm-council

## Goal

Run the `cadence-forge:review-loop` skill against three open PRs (#55, #56, #57) and let the loop drive itself: poll CodeRabbit findings, fix them, push, re-poll, until clean. Capture the protocol nuances and operational gotchas that only surface from actually running the loop end-to-end across multiple PRs and multiple rounds.

## What we tried

Started the loop with three PRs, 7-minute cron interval, default skill behavior. Initially expected: CodeRabbit posts findings, I fix them, push, mark clean. Reality involved several detours:

- Initial poll missed pre-existing reviews (timestamp filter trap)
- Mid-session 1Password SSH-signing failure blocked one PR's commit
- Reproducing a streaming-mode bug in tests required a custom async context manager (MockTransport pre-buffers)
- CodeRabbit's "incremental review" semantics created ambiguity about when a PR is actually clean
- Loop ran 9 rounds total before all three PRs settled; reactivated for one more PR (#58) which cleared on first tick

## Gotchas

### Gotcha 1: Initial `last_poll = "now"` misses pre-existing reviews

Setting `last_poll: "<current UTC>"` on loop init seemed natural. But three PRs already had completed CodeRabbit reviews from ~30 min prior. The round-1 filter `select(.submitted_at > $last_poll)` quietly excluded all of them. The PRs *looked* silent on first poll.

The signal that something was off: `gh pr checks` showed `CodeRabbit pass — Review completed` but the filtered query for reviews/comments returned empty. That asymmetry says "review exists but predates `last_poll`."

**Fix:** Round 1 should always be unfiltered. After it, set `last_poll` to the current UTC for round 2 onward. Captured separately in memory as `review-loop-init-poll-trap.md`.

### Gotcha 2: 1Password `op-ssh-sign` failed mid-commit

Hit `error: 1Password: failed to fill whole buffer` on the first attempt to commit PR #55's round-1 fix. Likely a Touch ID prompt that the GUI surface couldn't deliver to a non-interactive Bash. Per project rules I can't bypass signing without explicit authorization, so the commit was stuck.

The recovery worked surprisingly well:

```bash
git stash push -m "round1-pr55-retry-fix" backend/council_stream.py
git checkout fix/per-model-error-noise   # different PR
# ... fix #56's round-1 findings, commit, push (signing recovered) ...
git checkout fix/stage2-skip-failed-models
git stash pop
git commit -m "..."   # now succeeds
```

`git stash push <files>` carries uncommitted work across branch switches without polluting the destination branch's diff. The signing path naturally recovered after a few minutes — likely Touch ID timeout cleared.

**Decision made:** never silently `--no-verify`. Stashing+pivoting to other work cost ~7 minutes; bypassing signing would have violated the project's commit-signing convention and made the audit trail inconsistent.

### Gotcha 3: `httpx.MockTransport` cannot reproduce streaming-context-closure bugs

Tried to write a regression test for PR #57 (RC-3 from the cascade — streaming-mode error message lost detail). MockTransport pre-buffers the response body into `_content` immediately, so `aread()` always succeeds regardless of context-manager lifecycle. The test passed on both the buggy and fixed code — no signal.

What was needed: a custom async CM that simulates real httpx behavior, where `aread()` returns empty after `__aexit__`:

```python
class FakeStreamCM:
    async def __aenter__(self):
        return response
    async def __aexit__(self, *args):
        state.cm_exited = True   # body becomes unreadable from here
        return False
```

Reference implementation lives in `tests/test_query_model.py::TestQueryModelStreamingErrorDetail._build_failing_stream_cm`. Captured separately in memory as `mocktransport-streaming-limit.md`.

### Gotcha 4: CodeRabbit's "review against last_push_sha" requires interpretation

The review-loop skill's exit criterion is strict: a PR is not clean until a review's `commit_id` matches `last_push_sha`. But CodeRabbit reviews *incrementally*. After PR #55's round-3 push (`545a0380`), CodeRabbit's API showed the latest review was still against round-2 (`0209341b`). 14 minutes passed without a new review.

I posted `@coderabbitai review` to re-trigger. The response was illuminating:

> Review triggered. Note: CodeRabbit is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.

So CodeRabbit had already incrementally reviewed `0209341b → 545a0380`, found nothing actionable, and posted nothing. The status check showed `pass`. The skill's literal interpretation would block the loop forever.

**Decision made:** treat `[no inline review posted within 2 polling rounds] AND [status check pass] AND [re-trigger response confirms incremental coverage]` as equivalent to "clean against `last_push_sha`." Applied this interpretation to PR #55 round 3 first, then to PR #56 round 4 once we'd seen the same pattern. Captured in memory as `coderabbit-incremental-review-semantics`.

### Gotcha 5: ASSERTIVE profile chains nitpicks proportional to PR scope

Across the four PRs in this session:

| PR | Scope | Rounds |
|----|-------|--------|
| #58 | 2 lines + docstring | 0 |
| #57 | 1 fix + custom-CM test | 0 |
| #55 | 1 fix + test (3 occurrences in code) | 3 |
| #56 | Test refactor with helper extraction | 4 |

Round-1 catches *correctness*. Round-2 catches *consistency* (denominator drift, downstream callers). Round-3 catches *abstraction* (extract helpers for repeated patterns). Round-4 catches *contract gaps in the helpers themselves* (asymmetric assertion logic).

If your goal is "merge fast," keep PRs surgical. Captured in memory as `coderabbit-pr-scope-vs-nitpicks.md`.

## Decisions made

- **Stay strict on signing.** Never `--no-verify` to dodge a transient 1Password failure. Pivot to other work, return when signing recovers.
- **Apply the incremental-review interpretation only after a re-trigger confirms it.** Without the explicit "does not re-review already reviewed commits" response, you can't distinguish "no findings" from "still reviewing."
- **Session-only cron over durable.** The loop ran ~50 min. A durable cron would have outlived the session and continued firing tomorrow. Session-only is the right default for any review-loop run that won't span multiple days.
- **One state file across loop sessions.** When the user reopened the loop for PR #58, kept the same `.review-loop.local.md` and appended a new "Previous loop sessions" section. The history of #55/#56/#57 stays alongside the new run.

## Recommendations

- **First round of any review-loop run: poll unfiltered.** Set `last_poll` to a timestamp from before the PRs were opened, OR skip the filter for round 1 and explicitly log "initial unfiltered sweep" in the iteration log.
- **For each PR, capture both `last_push_sha` AND the latest reviewed `commit_id`.** When they diverge, that's diagnostic — either CodeRabbit hasn't reviewed yet, or it has and posted nothing because the diff produced no findings. Distinguish with `@coderabbitai review`.
- **Re-trigger after 2 silent rounds, not 1.** CodeRabbit's typical lag for actionable findings is ~5-10 min. Two rounds (~14 min) is the right "this is silent, not slow" threshold.
- **When a 1Password commit fails, don't retry the exact same commit.** Stash, do something else, return. The likely cause is a stale Touch ID grant; pivoting buys time for the agent to recover without a fresh prompt.
- **Don't extract helpers pre-emptively in single-PR scope.** PRs that introduce abstractions get nitpicked on the abstraction. PRs that introduce just fixes get nitpicked on the fix being incomplete. Match the abstraction level to the PR's narrative — if you're refactoring tests, extract test helpers; if you're fixing a bug, fix the bug and let CodeRabbit propose the helper on round 2.
- **Trust the status check more than the review API for incremental confirmation.** `gh pr checks` shows the integration's overall state; the API endpoint shows only commits with explicit inline review activity. They diverge on incrementally-clean diffs.

## Key takeaways

- The skill's "review against `last_push_sha`" rule needs a soft interpretation when the reviewer is incremental. Strict adherence makes the loop unable to exit when CodeRabbit has nothing to say.
- The first poll of any loop session should be unfiltered. The cost is small; the cost of missing a Major finding because it predated `last_poll` is large.
- Mid-session signing failures are recoverable via stash + pivot. Total cost was ~7 minutes; never had to skip a hook.
- MockTransport is the wrong tool for tests that depend on streaming-response lifecycle. Use a custom async CM that explicitly tracks context-manager exit.
- 9 rounds across 3 PRs surfaced 7 distinct findings — some Major (parity bug), some Trivial (helper extraction). The variety justified the loop. A static "review once and merge" would have shipped 3 PRs that each had something the next round caught.
