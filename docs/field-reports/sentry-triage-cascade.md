# Sentry Triage Cascade — Field Report

**Date:** 2026-04-26
**Type:** investigation
**Project:** llm-council

## Goal

Triage a single Sentry issue (LLM-COUNCIL-8) reporting an HTTP 404 from OpenRouter against a deprecated model, then implement whatever fixes were warranted. Demonstrate that systematic root-cause investigation, applied even to a "small" Sentry alert, can surface multiple distinct bugs hiding behind one visible symptom.

## What we tried (and what changed mid-session)

The initial instinct was tactical: the model `google/gemini-3-pro-preview` 404s on OpenRouter, so swap it for a working model and ship. This would have closed the symptom in one trivial PR while leaving three other bugs in the code.

When the user invoked the `cadence:using-systematic-debugging` skill mid-session, we restarted. The Iron Law of that skill — "no fixes without root cause investigation first" — turned out to be load-bearing here. Without it, we would have shipped one PR that addressed the visible symptom and ignored the system that produced it.

## Root cause(s)

The Sentry breadcrumbs showed two `HTTP error … 404` lines for the *same model* in the *same request*:

```
23:49:00.116Z  HTTP error streaming  google/gemini-3-pro-preview (status 404). Detail: HTTP 404
23:49:42.985Z  HTTP error querying   google/gemini-3-pro-preview (status 404). Detail: No endpoints found for google/gemini-3-pro-preview.
```

That asymmetry — same model, same status, two different log messages — was the thread to pull. Tracing it surfaced four distinct issues:

### RC-1 (Major) — Stage 2 ranks failed Stage 1 models

`backend/council_stream.py:355-357` passed `input.council_models` (the original 8) into `stage2_collect_rankings`, regardless of which models actually produced Stage 1 responses. The dead model was asked to *rank* the 7 surviving responses and 404'd a second time, generating a duplicate Sentry event and an avoidable OpenRouter API call per request.

The pipeline already had the right shape — `stage1_results` excluded failures, and each result had a `model` field. The fix was deriving the ranker list from `stage1_results` instead of the input.

### RC-2 (Sentry noise) — Per-model HTTP errors logged at ERROR

`backend/openrouter.py:214` (parallel) and `:478` (streaming) logged any non-401/402 HTTP failure at `logger.error`. Sentry's default `LoggingIntegration` captures `ERROR`-level records as events. So every per-model failure became a Sentry event, even though the council pipeline gracefully degraded (7/8 ≠ failure). The aggregate "all models failed" branch in `council_stream.py:323` is the *correct* escalation point for genuine outages.

Fix: per-model HTTP/timeout failures drop to `warning`. Auth (401), billing (402), and unexpected exceptions stay at `error`.

### RC-3 (Cosmetic, but a real triage friction) — Streaming-mode error message lost detail

`backend/openrouter.py:456` called `_extract_error_message(e.response)` on a streaming response whose body had not yet been read. After `response.raise_for_status()` raised inside the `async with client.stream(...)` block and the context manager exited, the underlying connection closed and `aread()` returned empty — falling through to the bare `f"HTTP {status}"` fallback.

That's why the same 404 produced different messages: the parallel path's body was already loaded, the streaming path's wasn't. Fix: `await response.aread()` *inside* the context manager when status is non-2xx, before letting `raise_for_status` throw.

### RC-4 (Recurrence risk) — Stale defaults

`backend/config.py:27,33` referenced `google/gemini-3-pro-preview` from upstream karpathy v0 (2025-11-22 — alive then, since dropped). Not the trigger of the live Sentry issue (the user's frontend was sending its own model list), but every fresh install would hit the same wall. Replaced with `google/gemini-2.5-pro`.

## Pipeline overview — the cascade

| # | PR | Issue | Severity | Lines changed |
|---|----|-------|----------|----------------|
| 1 | #55 | RC-1 + retry pipelines parity (CodeRabbit Major round 1) | Headline bug | ~60 |
| 2 | #56 | RC-2 + 6 streaming-path tests (CodeRabbit Trivial round 1) | Sentry noise | ~140 |
| 3 | #57 | RC-3 + custom-CM regression test | Triage friction | ~120 |
| 4 | #58 | RC-4 | Recurrence risk | ~10 |

Each fix was its own PR with its own scoped test coverage. Bundling would have made it impossible to attribute the observed Sentry quiet-down to a specific change after deploy.

## Gotchas

- **MockTransport doesn't reproduce streaming bugs.** `httpx.MockTransport` pre-buffers response bodies, so it never simulates the post-`__aexit__` body-unavailability that real streams exhibit. RC-3's regression test required a custom async CM with explicit `_stream_closed` tracking. Captured separately as `mocktransport-streaming-limit.md`.
- **CodeRabbit's review profile chains nitpicks proportional to PR scope.** PRs #57 and #58 (small, surgical) landed clean on first pass. PR #55 took 3 rounds (correctness → consistency → abstraction). PR #56 took 4 rounds. Captured as `coderabbit-pr-scope-vs-nitpicks.md`.
- **The `dsn=""` Sentry init pitfall is real.** Already in project memory, but worth re-stating: an empty-string DSN crashes the SDK; must pass `dsn=None` to disable. Already handled correctly in `backend/main.py:13` (`os.environ.get("SENTRY_DSN") or None`).

## Recommendations

- **Default to systematic-debugging on any Sentry alert that involves a multi-stage pipeline.** The Iron Law's value is highest exactly when the symptom looks "obvious." LLM-COUNCIL-8 looked like "swap a dead model"; it was actually four distinct bugs, three of them invisible.
- **Read both error breadcrumbs in a single Sentry event before patching.** When the same operation fails *twice* in one request, that's a tell that one stage's failure isn't propagating to the next stage's input. The duplicate-failure-per-request signature is now in project memory as `multi-stage-pipeline-bug-pattern`.
- **Scope PRs to match desired review duration.** A single 4-line config change (#58) reviewed instantly. A test-helper refactor (#56) cycled 4 times. If you need to land fast, keep PRs surgical. If you have time, bundling related fixes invites a thorough review you couldn't have prompted yourself.
- **Lower per-model error severity *before* deploying a noisy code path.** Sentry's `LoggingIntegration` defaults make ERROR-level logs into events. Anywhere you have graceful degradation logic, make sure the per-iteration failure log is `warning`, not `error` — otherwise your "graceful" path generates a flood of Sentry events.
- **The `aggregate failure` branch should always be the only `error`-level escalation point in a degrading pipeline.** Keep that asymmetry intentional.

## Key Takeaways

- One Sentry issue, four root causes. The visible symptom (404) hid three invisible bugs (re-query, log noise, lost detail). Don't stop digging when the obvious fix presents itself.
- Systematic-debugging discipline pays compound returns when a system has multiple stages: each stage boundary is a place where a failure can be re-introduced, mis-logged, or mis-counted.
- Multi-PR cascades beat one-bundled-PR for traceability. Each Sentry event class can now be attributed to the deploy that fixed it.
- The CodeRabbit feedback loop on PRs #55 and #56 caught real defects (denominator drift, asymmetric assertion contract) that would have shipped otherwise. Worth the rounds.
- Keep a memory of the *pattern* (multi-stage failure-input-leak) separate from the *fix* (the specific code change). The pattern reappears in any pipeline with graceful degradation; the fix is unique to this codebase.
