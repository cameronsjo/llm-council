"""Persistent storage for council ELO ratings.

Two files per user:
  - matches.jsonl  — append-only source of truth, one pairwise comparison per line
  - ratings.json   — derived current state, atomic-write under the same lock

Ratings can be fully reconstructed from matches.jsonl by replaying every line.
That's the safety net: if ratings.json is ever corrupted or out of sync, delete
it and `load_ratings()` won't break — the next match append rebuilds it.

Mirrors backend/storage.py patterns: fcntl exclusive locking around the
read-modify-write window, atomic writes via tempfile+os.replace.
"""

import fcntl
import json
import logging
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DATA_BASE_DIR
from .elo import INITIAL_RATING, apply_match, extract_pairwise

logger = logging.getLogger(__name__)

RATINGS_VERSION = 1


def _rankings_dir(user_id: str | None) -> Path:
    """Resolve the per-user (or global) rankings directory."""
    if user_id:
        return Path(DATA_BASE_DIR) / "users" / user_id / "rankings"
    return Path(DATA_BASE_DIR) / "rankings"


def _matches_path(user_id: str | None) -> Path:
    return _rankings_dir(user_id) / "matches.jsonl"


def _ratings_path(user_id: str | None) -> Path:
    return _rankings_dir(user_id) / "ratings.json"


def _lock_path(user_id: str | None) -> Path:
    return _rankings_dir(user_id) / ".lock"


@contextmanager
def _rankings_lock(user_id: str | None = None):
    """Exclusive lock for the rankings directory.

    Same pattern as storage._pending_lock — one lock guards both files
    so the matches.jsonl append and ratings.json rewrite happen atomically
    relative to each other.
    """
    rdir = _rankings_dir(user_id)
    rdir.mkdir(parents=True, exist_ok=True)
    lock_fd = open(_lock_path(user_id), "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON atomically: tempfile in same dir + os.replace."""
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_ratings(user_id: str | None = None) -> dict[str, Any]:
    """Load current ratings. Returns empty container if no file yet."""
    path = _ratings_path(user_id)
    if not path.exists():
        return {"version": RATINGS_VERSION, "ratings": {}}
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("ratings.json unreadable for user=%s: %s", user_id, exc)
        return {"version": RATINGS_VERSION, "ratings": {}}


def record_stage2_matches(
    stage2_results: list[dict[str, Any]],
    label_to_model: dict[str, str],
    conversation_id: str,
    user_id: str | None = None,
) -> int:
    """Persist all pairwise comparisons from a Stage 2 round.

    Each voter's parsed_ranking is converted to (winner, loser) pairs and
    appended to matches.jsonl. Ratings.json is updated in the same critical
    section so readers never observe a state where the JSONL has more matches
    than the ratings reflect.

    A voter's own response is included in the rankings (Stage 2 doesn't tell
    voters which response is theirs), so we don't filter self-rankings.

    Args:
        stage2_results: list of dicts with at least {model, parsed_ranking}.
        label_to_model: anonymized-label → canonical-model mapping for this round.
        conversation_id: source conversation id (recorded for traceability).
        user_id: optional username for per-user isolation.

    Returns:
        Number of pairwise matches recorded. Zero is a valid outcome
        (e.g., all voters failed to produce parseable rankings).
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    pending_pairs: list[tuple[str, str, str]] = []  # (voter, winner, loser)
    for ranking in stage2_results:
        voter = ranking.get("model")
        parsed = ranking.get("parsed_ranking") or []
        if not voter or not parsed:
            continue
        for winner, loser in extract_pairwise(parsed, label_to_model):
            pending_pairs.append((voter, winner, loser))

    if not pending_pairs:
        return 0

    with _rankings_lock(user_id):
        # 1. Append to JSONL — source of truth.
        matches_file = _matches_path(user_id)
        matches_file.parent.mkdir(parents=True, exist_ok=True)
        with open(matches_file, "a") as f:
            for voter, winner, loser in pending_pairs:
                record = {
                    "ts": timestamp,
                    "conversation_id": conversation_id,
                    "voter": voter,
                    "winner": winner,
                    "loser": loser,
                }
                f.write(json.dumps(record) + "\n")

        # 2. Update derived ratings.json.
        state = load_ratings(user_id)
        ratings = state.setdefault("ratings", {})
        for _voter, winner, loser in pending_pairs:
            apply_match(ratings, winner, loser, timestamp)
        state["version"] = RATINGS_VERSION
        _atomic_write_json(_ratings_path(user_id), state)

    return len(pending_pairs)


def get_leaderboard(user_id: str | None = None) -> list[dict[str, Any]]:
    """Return current ratings as a sorted leaderboard.

    Sorted by rating descending, ties broken by games played descending
    (more games = more confidence in the rating).
    """
    state = load_ratings(user_id)
    ratings = state.get("ratings", {})
    rows = [
        {
            "model": model,
            "rating": round(info.get("rating", INITIAL_RATING), 1),
            "games": info.get("games", 0),
            "last_updated": info.get("last_updated"),
        }
        for model, info in ratings.items()
    ]
    rows.sort(key=lambda r: (-r["rating"], -r["games"]))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows


def replay_history(
    user_id: str | None = None, model_filter: str | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Replay matches.jsonl to produce per-model rating timelines.

    Walks the entire log applying ELO updates from scratch. After each match,
    snapshots the current rating of both participants. Output is suitable
    for a line chart with one series per model.

    Args:
        user_id: optional username for per-user isolation.
        model_filter: if set, only return that model's series (still replays
                      the whole log so opponents' ratings are accurate).

    Returns:
        {model_id: [{ts, rating, games}, ...]}. Empty dict if no log yet.
    """
    path = _matches_path(user_id)
    if not path.exists():
        return {}

    ratings: dict[str, dict[str, Any]] = {}
    history: dict[str, list[dict[str, Any]]] = {}

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("skipping malformed match record")
                continue
            winner = rec.get("winner")
            loser = rec.get("loser")
            ts = rec.get("ts")
            if not (winner and loser and ts):
                continue
            apply_match(ratings, winner, loser, ts)
            for model in (winner, loser):
                if model_filter and model != model_filter:
                    continue
                history.setdefault(model, []).append({
                    "ts": ts,
                    "rating": round(ratings[model]["rating"], 1),
                    "games": ratings[model]["games"],
                })
    return history
