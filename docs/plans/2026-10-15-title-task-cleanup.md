# Title task lifetime (#31)

Approved by the cos-council2 brief and GO. Codex owns request task cleanup; no retry policy, security behavior, or stream-versus-snapshot ownership changes.

- [x] Initialize the title task before each generator try/finally and cancel/await it on every exit.
- [x] Close the nested council pipeline explicitly when its HTTP stream closes or shutdown ends it early.
- [x] Verify failed, cancelled, closed, and successful title generation in both modes.
- [x] Review the final diff and run repository checks. Delivery is recorded in the run report and GitHub PR.

Evidence: 312 backend tests, 203 frontend tests, and production build pass. Scoped Ruff and formatting checks pass. Original main fails seven lifecycle regressions; a no-op cleanup helper fails the completed-task retrieval check. Independent review found no production defects. Existing global lint/format debt remains in #61.
