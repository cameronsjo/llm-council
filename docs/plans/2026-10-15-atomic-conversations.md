# Atomic conversation storage (#24)

Scope: atomic conversation persistence and serialized mutations for issue #24.

- [x] Inspect every conversation mutator and reuse the pending-file atomic replacement pattern.
- [x] Serialize each whole read-modify-write with a per-user, per-conversation sidecar lock; keep sidecars stable across replacement and validate their inode after acquisition.
- [x] Verify failed serialization/replacement preserves existing data and concurrent updates survive.
- [x] Remove sidecars under the lock when the conversation is absent; retry stale-inode waiters and avoid creating files for nonexistent deletes.
- [x] Review the net diff and run the repository checks. Delivery is recorded in the run report and GitHub PR.

Validation: filesystem regressions cover failed writes, concurrent updates, delete cleanup, nonexistent deletes, and waiters holding an unlinked sidecar. Repository-wide lint debt remains tracked in #61.

No security policy or conversation-state ownership changes. Public save writes a complete supplied snapshot; callers performing mutations use the locked storage operations.
