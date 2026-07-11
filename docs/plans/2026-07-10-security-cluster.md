# llm-council Security Cluster — Fix Plan (#40, #37, #38) — 2026-07-10

## Context

Three backend robustness/security issues in `cameronsjo/llm-council`. This plan is a
self-contained contract for a future session with zero prior context.

- **Repo:** the local clone of `cameronsjo/llm-council`.
- **Branch caution:** the working checkout is currently on `design/deliberation-instrument`,
  **not** `main`. This plan targets **`main`**. Every `file:line` below is anchored to
  `origin/main` (read via `git -C <repo> show origin/main:<path>`), which may differ from the
  checked-out branch. Re-anchor line numbers against `origin/main` before editing; the code may
  have moved by pickup time.
- **Verified state (origin/main, 2026-07-10):** none of the three issues are fixed on main. All
  are real and reproduce as described. `_get_client_ip` is not covered by any test today
  (`tests/` grep for `_get_client_ip` → no hits); the upload and lifespan handlers have no
  integration coverage either.
- **Test entrypoints:** `tests/test_auth.py`, `tests/test_attachments.py`, `tests/test_shutdown.py`.
  `TestClient(app)` pattern exists in `tests/test_rankings_api.py` (import `from backend.main import app`).
  Env vars are set in `tests/conftest.py` before backend import.

## Threat summary

| # | Attacker capability | Impact |
|---|---|---|
| 40 | Send arbitrary `X-Forwarded-For` + `Remote-User` headers to the app's TCP port | Full auth bypass — authenticate as any username (incl. non-existent), since `User` is built from unvalidated headers. **Highest severity.** |
| 37 | POST a multi-GB body to `/api/attachments` (auth optional on this route) | Resource-exhaustion DoS. Starlette spools the body to disk before the handler runs, so the receipt-level control is a proxy body-limit (absent in `docker-compose.yml` today); the handler fix bounds only *resident memory*. Worker stress before the size check; no per-user upload rate/concurrency cap compounds it. |
| 38 | Trigger a container stop (SIGTERM) during active streams — or it happens on any deploy | In-flight LLM streams get their shared httpx pool closed after a fixed 1s, aborting Stage 2/3 mid-call. User is billed for work never delivered; the clean `server_shutdown` handoff is replaced by a raw connection error. Availability/spend, not confidentiality. |

---

## Fix spec — #40: X-Forwarded-For auth bypass

**Current code (evidence):**
- `backend/auth.py:94-115` — `_get_client_ip` returns the **leftmost** `X-Forwarded-For` value,
  falling back to `request.client.host` only when the header is absent.
- `backend/auth.py:135` — `get_current_user` passes that value to `_is_trusted_ip` (`auth.py:137`)
  to gate whether `Remote-User`/`Remote-Email`/`Remote-Groups` are honored.
- `backend/auth.py:22-25` — default `TRUSTED_PROXY_IPS` = `127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`
  (all RFC1918 + loopback). The app binds `0.0.0.0:8001` (`main.py:1131`), so any peer that can reach
  the port and spoofs an in-range XFF passes the gate.

**Security reasoning:** the leftmost XFF is the *client's own claim* about its IP — fully
attacker-controlled. The trust decision must key on the **immediate TCP peer** (`request.client.host`),
which the attacker cannot forge without controlling the socket. XFF is safe to *log* once the peer is
already trusted, never to *decide* trust.

**Change:**
1. Add `_get_peer_ip(request: Request) -> str` returning **only** `request.client.host` (or `""`).
   Route the trust decision in `get_current_user` (`auth.py:135`) through `_get_peer_ip`, not
   `_get_client_ip`.
2. Keep `_get_client_ip` for *audit logging only* — on the untrusted-peer warning
   (`auth.py:138-143`), log both the trusted peer and the XFF-claimed client so operators keep
   forwarded-client visibility.
3. Fix the lying comment at `auth.py:104` — it claims "rightmost IP that we didn't add" while the
   code returns the **leftmost** XFF value. Correct it as part of this change so future readers
   aren't bamboozled.
4. **Keep the wide RFC1918 default `TRUSTED_PROXY_IPS`** (`auth.py:22-25`, all five entries)
   unchanged. Do **not** narrow it: the target deploy runs the proxy (Authelia/OIDC) in a
   *separate* container and `docker-compose.yml` exposes `8001:8001`, so the app's TCP peer is a
   docker-bridge RFC1918 address — narrowing to loopback would lock out the exact deployment this
   repo targets (and break `test_default_ips_parse_correctly`, which asserts the 5-entry default).
   The peer-IP fix (steps 1–2) is THE fix; the default is correct as-is.
5. **Operator hardening (docs, not code):** in `docs/auth-setup.md`, tell operators to pin
   `LLMCOUNCIL_TRUSTED_PROXY_IPS` to the proxy's *specific* container/host IP — defense-in-depth as
   an operator choice, not a forced default.

(#39 — the `lru_cache`-never-invalidated bug on `_parse_trusted_ips` at `auth.py:44` — ships as its
own **commit 4** of this cluster PR; see Sequencing.)

**Tests (`tests/test_auth.py`):**
- **Enabling auth in tests (mandatory):** `AUTH_ENABLED` is an *import-time* constant
  (`auth.py:18`), so `monkeypatch.setenv` is a FALSE-GREEN — auth stays off and the attack test
  passes for the wrong reason. Use `monkeypatch.setattr(backend.auth, "AUTH_ENABLED", True)`.
  Likewise, because `_parse_trusted_ips` is `@lru_cache`d, any test that mutates
  `TRUSTED_PROXY_IPS` must `monkeypatch.setattr(backend.auth, "TRUSTED_PROXY_IPS", ...)` **and**
  call `backend.auth._parse_trusted_ips.cache_clear()` in setup and in fixture teardown.
- Unit: `_get_peer_ip` returns `request.client.host` and **ignores** an `X-Forwarded-For` header
  entirely (build a Starlette `Request` from a scope with `client=("203.0.113.9", 12345)` and an
  XFF header; assert the peer, not the header).
- **Attack case (integration, `TestClient`):** with `AUTH_ENABLED` monkeypatched True, call
  `GET /api/user` (`main.py:268` — **not** `/api/attachments`, whose `get_optional_user` returns
  `None` → 200 and can never prove the bypass) with `X-Forwarded-For: 127.0.0.1` +
  `Remote-User: ghost`. NOTE: `/api/user` **also** uses `get_optional_user`, and **no route on
  main uses `require_auth`** — so the endpoint returns HTTP **200** either way; the regression is
  proven by the response **body**, not the status code: after the fix `{"authenticated": false}`,
  before the fix `{"authenticated": true, "username": "ghost"}` (`TestClient`'s peer `"testclient"`
  is untrusted, so the spoofed XFF no longer grants trust). This matches issue #40's own Verify
  section. (The orchestrator ruling said "401"; corrected here — main has no 401 route.)
- Positive: a `Request` whose scope `client` is `("127.0.0.1", n)` with `Remote-User` set →
  `get_current_user` returns a `User`. (Use a scope-built `Request` or a dependency override, since
  `TestClient` fixes the peer to `testclient`.)

**Acceptance:** the attack case's response body flips to `{"authenticated": false}`; peer-based
trust proven by unit test; auth suite green with the wide default preserved
(`test_default_ips_parse_correctly` unchanged); `docs/auth-setup.md` documents peer-IP trust + the
operator pin-to-specific-IP guidance.

**Config/deploy:** trust is now peer-based — the reverse proxy **must** be the TCP peer. Default
`LLMCOUNCIL_TRUSTED_PROXY_IPS` stays the wide RFC1918 set (correct for the separate-container proxy);
operators SHOULD pin it to the proxy's specific IP for defense-in-depth.

---

## Fix spec — #37: upload DoS (full body buffered before size check)

**Current code (evidence):**
- `backend/main.py:381-407` — `upload_attachment`; `content = await file.read()` at
  `main.py:396` buffers the whole upload, then `validate_file` (`main.py:400`) checks size.
- `backend/attachments.py:21-23` — caps: `MAX_TEXT_SIZE` 1 MB, `MAX_IMAGE_SIZE` 5 MB,
  `MAX_PDF_SIZE` 10 MB. `validate_file` (`attachments.py:69-95`) only sees size *after* the read.
- The handler takes no `Request` param today, so it can't inspect `Content-Length`.

**Security reasoning / honest nuance:** Starlette's multipart parser **already spools the
`UploadFile` to a `SpooledTemporaryFile`** (memory up to ~1 MB, then disk) *before* the handler
runs — so by the time `upload_attachment` executes, the body has been fully received. A chunked
read in the handler therefore bounds the in-*memory* `content: bytes`, but does **not** prevent
receipt of the body. The primary DoS control must sit at the ingress. Layer the defenses:

**Status-code contract:** `413 Request Entity Too Large` for the >10 MB gate (Content-Length
precheck OR chunked cap); the existing `400` is **retained** for per-type `validate_file` failures
(e.g. a 2 MB `.txt` exceeding `MAX_TEXT_SIZE` → 400, an unsupported extension → 400). The two paths
are distinct and both must be tested.

**Change:**
1. **Primary — proxy/server body limit (deployment task, load-bearing):** `docker-compose.yml` has
   **no** request-body limit today. Add one at the reverse proxy (Traefik `maxRequestBodyBytes` /
   nginx `client_max_body_size`) at or just above `MAX_PDF_SIZE` (10 MB), and document it in
   `docs/auth-setup.md`. This is the *only* layer that stops bytes from being received — treat it
   as a real deliverable, not a footnote.
2. **Fast reject — `Content-Length` (own helper):** extract a
   `content_length_exceeds(request, cap) -> bool` helper. Add `request: Request` to the handler and
   call it before reading; return `413` if it exceeds `MAX_PDF_SIZE`. **Guard the parse:** a
   malformed or duplicated `Content-Length` (`int()` `ValueError`) is treated as **absent** — fall
   through to the chunked cap, never raise 500. Spoofable, so it's an optimization, not a guarantee.
3. **Hard in-memory cap — chunked read helper:** `async def read_capped(file: UploadFile, cap:
   int) -> bytes` — loop `while chunk := await file.read(65536)`, accumulate, and
   `raise HTTPException(413, "File too large")` the moment the running total exceeds `cap`; return
   `b"".join(chunks)`. Be honest: `b"".join` still materializes ≤`cap` bytes in memory — bounded,
   not streamed. Replace `content = await file.read()` (`main.py:396`) with
   `content = await read_capped(file, MAX_PDF_SIZE)`.
4. Keep the existing per-type `validate_file` check after the read (a 6 MB image still fails its
   5 MB cap → 400) — `read_capped` uses the *largest* type ceiling (`MAX_PDF_SIZE`) as a coarse gate.

**Tests (`tests/test_attachments.py` + an integration test):**
- Unit `read_capped`: raises `HTTPException(413)` at the cap; returns full content under it (feed a
  fake `UploadFile` / `SpooledTemporaryFile`).
- Unit `content_length_exceeds`: True over cap, False under; **malformed/duplicated header returns
  False** (treated as absent), never raises. This is the fast-path seam — test the helper directly;
  **drop the TestClient header-spoof test** (`TestClient` recomputes `Content-Length`, so there's
  no seam there).
- **Attack case (integration, `TestClient`):** POST `/api/attachments` with a body just over 10 MB
  → `413`, helpful detail, and (assert) `save_attachment` is **not** called (patch/spy it).
- Both-codes contract: a 2 MB `.txt` (over `MAX_TEXT_SIZE`, under `MAX_PDF_SIZE`) → **400** via
  `validate_file`; a >10 MB body → **413** via the cap. Assert each path hits its own code.
- Regression: a valid small text/image/PDF still returns `200` and persists.

**Acceptance:** >10 MB upload returns `413` without OOM; per-type overflow still `400`; malformed
`Content-Length` never 500s; valid uploads unaffected; `docker-compose.yml`/`docs` gain a proxy
body-limit as the receipt-level control.

**Config/deploy:** proxy body-size limit (primary, **new** — none exists today); optionally
uvicorn/h11 request limits. No new env var required unless the caps are made configurable (not needed).

---

## Fix spec — #38: graceful shutdown kills in-flight streams

**Current code (evidence):**
- `backend/main.py:96-109` — `lifespan`: after `yield`, `initiate_shutdown()` (`main.py:101`),
  then a **fixed** `await asyncio.sleep(1)` (`main.py:108`) regardless of stream count, then
  `await close_shared_client()` (`main.py:109`) — which rips the shared httpx pool out from under
  any generator still awaiting `client.stream(...)`.
- `backend/shutdown.py:26-66` — `ShutdownCoordinator` already tracks `active_stream_count` and
  streams register/unregister around each SSE handler (`main.py:636/644`, `648/835`, … `1006/1091`).
- `main.py:1131` — uvicorn `timeout_graceful_shutdown=90`; `docker-compose.yml` sets
  `stop_grace_period: 120s`. Both budgets are wasted by the 1s sleep.

**Reasoning:** the coordinator's whole design is to let streams emit a clean `server_shutdown`
event and finish their current LLM call before the pool closes. The client must stay open until
`active_stream_count` reaches 0 (or a deadline), not for a flat 1s.

**Change:**
1. Extract a testable async helper
   `async def drain_streams(coordinator, timeout, poll=0.5, *, clock=None)`:
   - **Resolve the clock inside the coroutine**, not at def time: `clock = clock or
     asyncio.get_running_loop().time`. A def-time default of `asyncio.get_running_loop().time`
     evaluates at *import*, where there is no running loop → `RuntimeError` on module load. The
     `None` sentinel resolved inside the running coroutine is the only safe form.
   - **Capture the deadline origin BEFORE the poll loop starts:** `deadline = clock() + timeout`.
     Then loop while `coordinator.active_stream_count > 0`, `await asyncio.sleep(poll)`, and
     `logger.warning("Forcing shutdown with %d streams still active", ...)` + break once
     `clock() > deadline`.
2. In `lifespan` (`main.py:100-109`): `initiate_shutdown()` → `await drain_streams(...)` →
   `await close_shared_client()`.
3. Timeout: default **85s — strictly under uvicorn's 90s** `timeout_graceful_shutdown`. uvicorn
   cancels the lifespan task at *exactly* `timeout_graceful_shutdown`; an equal 90s budget means the
   `await close_shared_client()` after the drain may be cancelled and never run → **connection-pool
   leak**. Nest the drain (85s) inside uvicorn's 90s inside docker's 120s. Expose as a module
   constant (optionally `LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS` env), and clamp/document it to stay
   `< timeout_graceful_shutdown`.
4. **Stacking note (in a comment):** uvicorn may wait up to 90s for open *connections* **before** it
   runs the lifespan shutdown, so worst case is that connection wait + the 85s drain, approaching
   docker's 120s `stop_grace_period` hard kill. Nesting bounds it; don't widen the drain toward 90s.

**Tests (`tests/test_shutdown.py`):** inject a controllable `clock` and short `poll` for determinism.
- `drain_streams` returns promptly when count is already 0.
- With count > 0 that drops to 0 after N polls (decrement via a side-effecting fake clock/counter),
  it completes without hitting the deadline.
- Deadline honored: count stays > 0, injected clock jumps past `timeout` → returns and logs the
  warning (assert via `caplog`).
- Deadline origin: assert the deadline is computed from the clock value *before* the first poll (a
  clock that advances each call must not push the deadline forward on every iteration).
- Order guard: `close_shared_client` is not awaited until `drain_streams` returns (spy both).

**Acceptance:** shutdown waits for real drain up to 85s, then force-closes with a warning;
`close_shared_client` always runs after the drain resolves (proven by the order guard, and 85s < 90s
means it is not cancelled); existing coordinator tests stay green.

**Config/deploy:** invariant `drain (85) < timeout_graceful_shutdown (90) < stop_grace_period (120)`
— note it in a comment so future edits don't invert it and reintroduce the pool leak.

---

## Sequencing & branch strategy

**Recommendation: one cluster PR, four commits, off `main`, in order #40 → #37 → #38 → #39.** Justification:
- The four are a themed security/robustness batch sharing one reviewer's context; a single PR keeps
  the review cohesive.
- #37 and #38 **both edit `backend/main.py`** but in far-apart regions (lines ~96-109 vs ~381-407),
  so one PR avoids inter-PR rebase churn that separate PRs would incur on the shared file.
- One commit per issue keeps each fix independently revertable and each diff scoped for review.

**Commit map (per-commit footprint):**
- **Commit 1 — #40:** `backend/auth.py` (peer-IP trust + comment fix), `docs/auth-setup.md`, `tests/test_auth.py`.
- **Commit 2 — #37:** `backend/main.py` (upload handler + helpers), `backend/attachments.py` (if helpers land there), `docker-compose.yml` + `docs/auth-setup.md` (proxy body-limit), `tests/test_attachments.py`.
- **Commit 3 — #38:** `backend/main.py` (lifespan), `backend/shutdown.py` (if `drain_streams` lands there), `tests/test_shutdown.py`.
- **Commit 4 — #39 (closes #39):** `backend/config.py:159` — add `backend.auth._parse_trusted_ips.cache_clear()` to `reload_config` so a config reload picks up a changed `TRUSTED_PROXY_IPS`; `tests/test_auth.py` or `tests/` covering the reload-invalidation. This commit **alone** touches `config.py`.

**Split only if release cadence demands it:** #40 is highest severity — if it must ship first, break
it (+ commit 4 #39, same file) into its own PR; a second PR then carries #37 + #38.

Branch: `fix/security-cluster-40-37-38` (or `fix/auth-xff-bypass` if splitting #40 out) from
`origin/main`. Do **not** build on the current `design/deliberation-instrument` checkout.

## Risks

- **#40 must NOT narrow the default `TRUSTED_PROXY_IPS`** — the target deploy's proxy is a separate
  container reached over the docker bridge (RFC1918), so a loopback-only default would break auth
  entirely for the intended deployment. The peer-IP fix closes the bypass without touching the
  default; keep all five entries. Residual risk: an operator who exposes `8001` to an untrusted
  network still trusts any peer in RFC1918 — mitigated by the docs guidance to pin to the proxy IP.
- **#37 chunked read is not a receipt-level control** — without a proxy body limit (absent today),
  a giant body is still received to disk. The proxy limit is a real deliverable, not a footnote.
- **#38 drain must stay strictly under uvicorn's 90s** — an equal budget risks the post-drain
  `close_shared_client()` being cancelled (pool leak); 85s is deliberate. Too-long a drain could
  delay container replacement, but it's bounded by uvicorn 90s / docker 120s hard kill.
- Line numbers may drift by pickup — re-anchor against `origin/main` before editing.

## Verification

1. `git -C <repo> fetch && git -C <repo> switch -c fix/... origin/main` (fresh from main).
2. Re-confirm each `file:line` against `origin/main` before editing.
3. Implement per issue; run `pytest tests/test_auth.py tests/test_attachments.py tests/test_shutdown.py -v`.
4. Full suite: `pytest` (not `make test` — #51 flags it as a no-op). Capture pass counts as evidence.
5. Manual #40 repro against a local run with `LLMCOUNCIL_AUTH_ENABLED=true`:
   `curl -H 'X-Forwarded-For: 127.0.0.1' -H 'Remote-User: ghost' http://localhost:8001/api/user`
   → must return body `{"authenticated": false}` after the fix (HTTP 200 either way — the body,
   not the status, is the signal, since `/api/user` uses `get_optional_user`).
6. Confirm each commit's `git diff --stat` stays within its footprint in the Commit map above
   (only commit 4 touches `config.py`); no unrelated files changed.

## Sources

- Issues (read-only via `gh ... --json`): `#40`, `#37`, `#38`, **`#39`** (folded in as commit 4) in
  `cameronsjo/llm-council` (all OPEN, all `bug`; no comments on any). Also referenced: `#51`
  (`make test` no-op), `#64` (docker hardening follow-ups).
- Code @ `origin/main`: `backend/auth.py:18,22-25,44,94-115,135-143`; `backend/main.py:96-109,268-269,381-407,1131`;
  `backend/attachments.py:21-23,69-95`; `backend/shutdown.py:26-66`; `backend/config.py:159`;
  `docker-compose.yml` (`stop_grace_period: 120s`, `8001:8001`). Verified: no route on `origin/main`
  uses `require_auth`; every route uses `get_optional_user`.
- Test patterns: `tests/test_auth.py`, `tests/test_attachments.py`, `tests/test_shutdown.py`,
  `tests/test_rankings_api.py` (`TestClient(app)`), `tests/conftest.py`.

## Panel review

Panel: 2× plan-reviewer (conflict/drift, under
24 findings (8 live-state confirmations), 16 folded, 0 declined. Verdicts: SOUND-WITH-FIXES ×3.
Orchestrator rulings folded: #40 default-narrowing **dropped** (locks out the containerized-proxy
deploy — proxy is a separate container over the docker bridge); **#39 included as commit 4**; #38
drain pinned at **85s** strictly inside uvicorn's 90s. Mechanical folds: AUTH_ENABLED/lru_cache
monkeypatch discipline, attack test pinned to `/api/user`, `auth.py:104` lying-comment fix, #37 dual
status-code contract (413 gate / 400 per-type), guarded Content-Length parse, `read_capped` /
`content_length_exceeds` helper contracts, header-spoof test dropped for a helper unit test, #38
`clock` None-sentinel + deadline-before-loop.

**Findings declined:** none — all actionable findings folded; the 8 red-team confirmations required
no change. One ruling was **corrected during the fold** (not declined): `/api/user` returns HTTP 200
with body `{"authenticated": false}`, not 401, since `origin/main` has no `require_auth` route — the
attack test asserts on the body, preserving the ruling's intent (use `/api/user`, not `/api/attachments`).
