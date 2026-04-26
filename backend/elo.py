"""ELO rating calculations for council model peer rankings.

Pure functions only — no I/O, no global state. All persistence lives in
rankings_storage. This module is the math.
"""

from typing import Any

# Standard ELO constants. K=32 is the classic chess starting K-factor;
# good calibration for systems with limited data and rotating rosters.
INITIAL_RATING = 1500.0
K_FACTOR = 32.0


def expected_score(rating_a: float, rating_b: float) -> float:
    """Expected probability that A beats B given current ratings.

    Standard ELO logistic formula: each 400 rating points = 10x odds.
    Returns a value in (0, 1). Symmetric: expected_score(a, b) + expected_score(b, a) == 1.
    """
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def update_pair(
    rating_a: float, rating_b: float, score_a: float, k: float = K_FACTOR
) -> tuple[float, float]:
    """Update both ratings after a match.

    Args:
        rating_a: Current rating of player A.
        rating_b: Current rating of player B.
        score_a: Actual outcome for A — 1.0 win, 0.5 draw, 0.0 loss.
        k: K-factor controlling adjustment magnitude.

    Returns:
        (new_rating_a, new_rating_b). Zero-sum: deltas are equal and opposite.
    """
    expected_a = expected_score(rating_a, rating_b)
    delta = k * (score_a - expected_a)
    return rating_a + delta, rating_b - delta


def extract_pairwise(
    parsed_ranking: list[str], label_to_model: dict[str, str]
) -> list[tuple[str, str]]:
    """Convert a single voter's ranked list into pairwise (winner, loser) tuples.

    A ranking [A, B, C] yields (A>B, A>C, B>C) — every higher-ranked label
    beats every lower-ranked label. Labels missing from label_to_model are
    skipped (defensive against stray text in parsed output).

    Args:
        parsed_ranking: Ordered list of anonymous labels (e.g. ["Response A", "Response C"]).
        label_to_model: Mapping from label to canonical model id.

    Returns:
        List of (winner_model, loser_model) tuples for every distinct pair
        in rank order.
    """
    resolved: list[str] = []
    for label in parsed_ranking:
        model = label_to_model.get(label)
        if model and model not in resolved:
            resolved.append(model)

    return [
        (winner, loser)
        for i, winner in enumerate(resolved)
        for loser in resolved[i + 1:]
    ]


def apply_match(
    ratings: dict[str, dict[str, Any]],
    winner: str,
    loser: str,
    timestamp: str,
) -> None:
    """Apply a single pairwise outcome to a ratings dict in place.

    Initializes either model at INITIAL_RATING if unseen. Each match counts
    as one game for both participants.

    Args:
        ratings: Mutable dict keyed by model id, values like
                 {"rating": float, "games": int, "last_updated": iso8601}.
        winner: Model id that ranked higher.
        loser: Model id that ranked lower.
        timestamp: ISO 8601 timestamp to record on both entries.

    No-op when winner == loser. Self-matches would alias both state dicts
    and double-increment `games`, silently corrupting state. Stray self-pairs
    from upstream parsing should be ignored, not recorded.
    """
    if winner == loser:
        return
    winner_state = ratings.setdefault(
        winner, {"rating": INITIAL_RATING, "games": 0, "last_updated": timestamp}
    )
    loser_state = ratings.setdefault(
        loser, {"rating": INITIAL_RATING, "games": 0, "last_updated": timestamp}
    )
    new_winner, new_loser = update_pair(
        winner_state["rating"], loser_state["rating"], score_a=1.0,
    )
    winner_state["rating"] = new_winner
    winner_state["games"] += 1
    winner_state["last_updated"] = timestamp
    loser_state["rating"] = new_loser
    loser_state["games"] += 1
    loser_state["last_updated"] = timestamp
