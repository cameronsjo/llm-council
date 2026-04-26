"""Tests for the pure ELO math module."""

import pytest

from backend.elo import (
    INITIAL_RATING,
    K_FACTOR,
    apply_match,
    expected_score,
    extract_pairwise,
    update_pair,
)


class TestExpectedScore:
    def test_equal_ratings_give_half(self):
        assert expected_score(1500, 1500) == pytest.approx(0.5)

    def test_symmetry(self):
        # expected_score(a, b) + expected_score(b, a) == 1
        for a, b in [(1500, 1700), (2000, 1200), (1234, 1567)]:
            assert expected_score(a, b) + expected_score(b, a) == pytest.approx(1.0)

    def test_higher_rated_favored(self):
        assert expected_score(1700, 1500) > 0.5
        assert expected_score(1300, 1500) < 0.5

    def test_400_point_gap_is_10x_odds(self):
        # Classic ELO calibration: 400 points = ~91% expected score
        # because 10**1 / (1 + 10**1) ≈ 0.909
        assert expected_score(1900, 1500) == pytest.approx(10 / 11, rel=1e-6)


class TestUpdatePair:
    def test_zero_sum(self):
        # Whatever A gains, B loses. Total rating preserved.
        a, b = 1600, 1400
        new_a, new_b = update_pair(a, b, score_a=1.0)
        assert (new_a + new_b) == pytest.approx(a + b)

    def test_winner_gains_loser_drops(self):
        new_a, new_b = update_pair(1500, 1500, score_a=1.0)
        assert new_a > 1500
        assert new_b < 1500
        # K=32, equal ratings, win → +16/-16
        assert new_a == pytest.approx(1516)
        assert new_b == pytest.approx(1484)

    def test_upset_moves_more(self):
        # Underdog winning gets a bigger bump than favorite winning
        underdog_new, _ = update_pair(1300, 1700, score_a=1.0)
        favorite_new, _ = update_pair(1700, 1300, score_a=1.0)
        assert (underdog_new - 1300) > (favorite_new - 1700)

    def test_draw_balances_ratings(self):
        # Higher-rated player loses ground in a draw against lower-rated.
        new_a, new_b = update_pair(1700, 1300, score_a=0.5)
        assert new_a < 1700
        assert new_b > 1300

    def test_k_factor_scales_change(self):
        a1, _ = update_pair(1500, 1500, score_a=1.0, k=32)
        a2, _ = update_pair(1500, 1500, score_a=1.0, k=16)
        # Half K → half the delta
        assert (a1 - 1500) == pytest.approx(2 * (a2 - 1500))


class TestExtractPairwise:
    def test_basic_three_way(self):
        ranking = ["Response A", "Response B", "Response C"]
        mapping = {"Response A": "model-a", "Response B": "model-b", "Response C": "model-c"}
        pairs = extract_pairwise(ranking, mapping)
        # 3 models = C(3,2) = 3 pairs: A>B, A>C, B>C
        assert pairs == [("model-a", "model-b"), ("model-a", "model-c"), ("model-b", "model-c")]

    def test_unknown_labels_skipped(self):
        # Stray label not in mapping is dropped silently
        ranking = ["Response A", "Response Z", "Response B"]
        mapping = {"Response A": "model-a", "Response B": "model-b"}
        pairs = extract_pairwise(ranking, mapping)
        assert pairs == [("model-a", "model-b")]

    def test_duplicate_labels_dedupe(self):
        # Defensive: model parser sometimes repeats. Treat first occurrence as canonical.
        ranking = ["Response A", "Response A", "Response B"]
        mapping = {"Response A": "model-a", "Response B": "model-b"}
        pairs = extract_pairwise(ranking, mapping)
        assert pairs == [("model-a", "model-b")]

    def test_empty_ranking(self):
        assert extract_pairwise([], {}) == []

    def test_single_label_no_pairs(self):
        # Can't form a pair from one entry
        pairs = extract_pairwise(["Response A"], {"Response A": "model-a"})
        assert pairs == []


class TestApplyMatch:
    def test_initializes_unseen_models(self):
        ratings: dict = {}
        apply_match(ratings, "winner", "loser", "2026-04-25T18:00:00Z")
        assert ratings["winner"]["games"] == 1
        assert ratings["loser"]["games"] == 1
        assert ratings["winner"]["rating"] > INITIAL_RATING
        assert ratings["loser"]["rating"] < INITIAL_RATING

    def test_increments_games(self):
        ratings: dict = {}
        apply_match(ratings, "a", "b", "t1")
        apply_match(ratings, "a", "b", "t2")
        assert ratings["a"]["games"] == 2
        assert ratings["b"]["games"] == 2

    def test_records_timestamp(self):
        ratings: dict = {}
        apply_match(ratings, "a", "b", "2026-04-25T18:00:00Z")
        apply_match(ratings, "a", "b", "2026-04-25T19:00:00Z")
        assert ratings["a"]["last_updated"] == "2026-04-25T19:00:00Z"

    def test_zero_sum_preserved_across_matches(self):
        ratings: dict = {}
        apply_match(ratings, "a", "b", "t")
        apply_match(ratings, "b", "a", "t")
        # Rating total preserved (start = 2 * INITIAL_RATING)
        total = ratings["a"]["rating"] + ratings["b"]["rating"]
        assert total == pytest.approx(2 * INITIAL_RATING)

    def test_constants_match_classical_chess(self):
        # Sanity: K=32 is the classic value, drift if anyone changes it
        assert K_FACTOR == 32.0
        assert INITIAL_RATING == 1500.0
