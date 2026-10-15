# Atomic conversation storage (#24)

Approved scope: Codex implements issue #24 from the cos-council2 brief and GO; one feature branch and ready PR, no merge.

- [x] Inspect every conversation mutator and reuse the pending-file atomic replacement pattern.
- [x] Serialize each whole read-modify-write with a per-user, per-conversation sidecar lock; keep sidecars stable across replacement/deletion.
- [x] Verify failed serialization/replacement preserves existing data and concurrent updates survive.
- [x] Review the net diff and run the repository checks. Delivery is recorded in the run report and GitHub PR.

Validation: 307 backend tests pass; scoped storage Ruff and formatting checks pass. Atomic-write regressions fail against origin/main as expected. Independent code review found no supported defects. Existing repository-wide lint debt remains tracked in #61.

No security policy or conversation-state ownership changes. Public save writes a complete supplied snapshot; callers performing mutations use the locked storage operations.
