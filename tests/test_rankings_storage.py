"""Tests for rankings persistence (matches.jsonl + ratings.json)."""

import json
from pathlib import Path

import pytest

from backend import rankings_storage
from backend.elo import INITIAL_RATING


@pytest.fixture
def isolated_data_dir(tmp_path, monkeypatch):
    """Point storage at a fresh temp dir for each test."""
    monkeypatch.setattr(rankings_storage, "DATA_BASE_DIR", str(tmp_path))
    return tmp_path


def _stage2_round(voter_rankings: list[tuple[str, list[str]]]):
    """Helper: build a stage2_results-shaped payload from (voter, [labels]) pairs.

    Tests pass ``label_to_model`` separately to ``record_stage2_matches``;
    the helper just needs the per-voter rankings.
    """
    return [
        {"model": voter, "parsed_ranking": labels}
        for voter, labels in voter_rankings
    ]


class TestRecordStage2Matches:
    def test_writes_jsonl_and_ratings(self, isolated_data_dir):
        label_to_model = {
            "Response A": "model-a",
            "Response B": "model-b",
            "Response C": "model-c",
        }
        # Three voters, all rank A > B > C
        results = _stage2_round([
            ("model-a", ["Response A", "Response B", "Response C"]),
            ("model-b", ["Response A", "Response B", "Response C"]),
            ("model-c", ["Response A", "Response B", "Response C"]),
        ])
        count = rankings_storage.record_stage2_matches(
            results, label_to_model, conversation_id="conv-1", user_id=None
        )
        # 3 voters × C(3,2) = 9 pairwise comparisons
        assert count == 9

        matches_file = Path(isolated_data_dir) / "rankings" / "matches.jsonl"
        assert matches_file.exists()
        lines = matches_file.read_text().strip().splitlines()
        assert len(lines) == 9

        # Every line must be valid JSON with the expected fields
        for line in lines:
            rec = json.loads(line)
            assert set(rec) == {"ts", "conversation_id", "voter", "winner", "loser"}
            assert rec["conversation_id"] == "conv-1"

    def test_ratings_reflect_unanimous_winner(self, isolated_data_dir):
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        results = _stage2_round([
            ("alpha", ["Response A", "Response B"]),
            ("beta", ["Response A", "Response B"]),
        ])
        rankings_storage.record_stage2_matches(results, label_to_model, "c", None)
        state = rankings_storage.load_ratings()
        assert state["ratings"]["alpha"]["rating"] > INITIAL_RATING
        assert state["ratings"]["beta"]["rating"] < INITIAL_RATING
        assert state["ratings"]["alpha"]["games"] == 2
        assert state["ratings"]["beta"]["games"] == 2

    def test_empty_rankings_records_nothing(self, isolated_data_dir):
        # Voters present but no parsed_rankings (e.g., parser failed)
        results = [{"model": "alpha", "parsed_ranking": []}]
        count = rankings_storage.record_stage2_matches(results, {}, "c", None)
        assert count == 0
        # No files created
        assert not (Path(isolated_data_dir) / "rankings" / "matches.jsonl").exists()

    def test_per_user_isolation(self, isolated_data_dir):
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        results = _stage2_round([("alpha", ["Response A", "Response B"])])
        rankings_storage.record_stage2_matches(results, label_to_model, "c", user_id="alice")
        rankings_storage.record_stage2_matches(results, label_to_model, "c", user_id="bob")

        alice_state = rankings_storage.load_ratings("alice")
        bob_state = rankings_storage.load_ratings("bob")
        # Each user has independent ratings — same input, same outcome
        assert alice_state["ratings"]["alpha"]["games"] == 1
        assert bob_state["ratings"]["alpha"]["games"] == 1
        # Anonymous user has no data
        assert rankings_storage.load_ratings(None) == {"version": 1, "ratings": {}}

    def test_replay_matches_live_updates(self, isolated_data_dir):
        """Source-of-truth invariant: replaying matches.jsonl yields the same ratings."""
        label_to_model = {"Response A": "alpha", "Response B": "beta", "Response C": "gamma"}
        # Two rounds with mixed outcomes
        rankings_storage.record_stage2_matches(
            _stage2_round([
                ("alpha", ["Response A", "Response B", "Response C"]),
                ("beta", ["Response B", "Response A", "Response C"]),
            ]),
            label_to_model, "c1", None,
        )
        rankings_storage.record_stage2_matches(
            _stage2_round([
                ("gamma", ["Response C", "Response A", "Response B"]),
            ]),
            label_to_model, "c2", None,
        )

        live = rankings_storage.load_ratings()["ratings"]
        # Replay from scratch
        history = rankings_storage.replay_history()
        # Final entry per model should match the live rating.
        # `replay_history` rounds each snapshot to 1dp while internal state
        # accumulates at full precision; `load_ratings` returns full
        # precision. Compare both at 1dp with an explicit tolerance to
        # absorb any per-step rounding drift over many matches.
        for model, snapshots in history.items():
            final_replay = snapshots[-1]["rating"]
            final_live = round(live[model]["rating"], 1)
            assert final_replay == pytest.approx(final_live, abs=0.1)


class TestGetLeaderboard:
    def test_empty_when_no_data(self, isolated_data_dir):
        assert rankings_storage.get_leaderboard() == []

    def test_sorted_descending_with_ranks(self, isolated_data_dir):
        label_to_model = {"Response A": "winner", "Response B": "loser"}
        rankings_storage.record_stage2_matches(
            _stage2_round([("winner", ["Response A", "Response B"])]),
            label_to_model, "c", None,
        )
        board = rankings_storage.get_leaderboard()
        assert len(board) == 2
        assert board[0]["model"] == "winner"
        assert board[0]["rank"] == 1
        assert board[1]["model"] == "loser"
        assert board[1]["rank"] == 2
        assert board[0]["rating"] > board[1]["rating"]


class TestLoadRatings:
    def test_rebuilds_from_log_when_ratings_json_missing(self, isolated_data_dir):
        """If ratings.json is deleted but matches.jsonl exists, leaderboard rebuilds."""
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        rankings_storage.record_stage2_matches(
            _stage2_round([("alpha", ["Response A", "Response B"])]),
            label_to_model, "c", None,
        )
        ratings_file = Path(isolated_data_dir) / "rankings" / "ratings.json"
        ratings_file.unlink()
        state = rankings_storage.load_ratings()
        assert state["ratings"]["alpha"]["games"] == 1
        assert state["ratings"]["alpha"]["rating"] > 1500

    def test_rebuilds_from_log_when_ratings_json_corrupt(self, isolated_data_dir):
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        rankings_storage.record_stage2_matches(
            _stage2_round([("alpha", ["Response A", "Response B"])]),
            label_to_model, "c", None,
        )
        ratings_file = Path(isolated_data_dir) / "rankings" / "ratings.json"
        ratings_file.write_text("not valid json {{{")
        state = rankings_storage.load_ratings()
        assert "alpha" in state["ratings"]
        assert state["ratings"]["alpha"]["games"] == 1

    def test_rebuilds_when_ratings_json_has_invalid_shape(self, isolated_data_dir):
        # Parseable JSON, wrong shape (ratings should be a dict, not a list).
        # Without schema validation this passes load_ratings and explodes
        # downstream when callers try to iterate `.items()`.
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        rankings_storage.record_stage2_matches(
            _stage2_round([("alpha", ["Response A", "Response B"])]),
            label_to_model, "c", None,
        )
        ratings_file = Path(isolated_data_dir) / "rankings" / "ratings.json"
        ratings_file.write_text('{"version": 1, "ratings": []}')  # valid JSON, invalid shape
        state = rankings_storage.load_ratings()
        # Should have rebuilt from the log
        assert isinstance(state["ratings"], dict)
        assert "alpha" in state["ratings"]
        assert state["ratings"]["alpha"]["games"] == 1

    def test_rebuilds_when_ratings_json_is_stale(self, isolated_data_dir):
        # Simulate crash after JSONL append but before ratings.json write:
        # match log has a record that ratings.json doesn't reflect.
        label_to_model = {"Response A": "alpha", "Response B": "beta"}
        rankings_storage.record_stage2_matches(
            _stage2_round([("alpha", ["Response A", "Response B"])]),
            label_to_model, "c1", None,
        )
        # Manually append a second match to JSONL but DO NOT update ratings.json
        matches_file = Path(isolated_data_dir) / "rankings" / "matches.jsonl"
        with open(matches_file, "a") as f:
            f.write('{"ts": "2026-04-26T00:00:00Z", "conversation_id": "c2", '
                    '"voter": "alpha", "winner": "alpha", "loser": "beta"}\n')
        state = rankings_storage.load_ratings()
        # Stale detection should have triggered a rebuild including the second match
        assert state["ratings"]["alpha"]["games"] == 2
        assert state["ratings"]["beta"]["games"] == 2


class TestUserIdValidation:
    def test_rejects_path_separator(self, isolated_data_dir):
        with pytest.raises(ValueError, match="Unsafe user_id"):
            rankings_storage.load_ratings(user_id="../etc/passwd")

    def test_rejects_dotdot(self, isolated_data_dir):
        with pytest.raises(ValueError, match="Unsafe user_id"):
            rankings_storage.load_ratings(user_id="..")

    def test_rejects_empty_string(self, isolated_data_dir):
        with pytest.raises(ValueError, match="Unsafe user_id"):
            rankings_storage.load_ratings(user_id="")

    def test_accepts_normal_usernames(self, isolated_data_dir):
        rankings_storage.load_ratings(user_id="alice")
        rankings_storage.load_ratings(user_id="user_42")
        rankings_storage.load_ratings(user_id="alice@example.com")


class TestReplayHistory:
    def test_returns_empty_when_no_log(self, isolated_data_dir):
        assert rankings_storage.replay_history() == {}

    def test_filter_returns_only_target_model(self, isolated_data_dir):
        label_to_model = {"Response A": "alpha", "Response B": "beta", "Response C": "gamma"}
        rankings_storage.record_stage2_matches(
            _stage2_round([
                ("alpha", ["Response A", "Response B", "Response C"]),
            ]),
            label_to_model, "c", None,
        )
        history = rankings_storage.replay_history(model_filter="alpha")
        assert set(history.keys()) == {"alpha"}
        # Alpha appears in 2 of the 3 pairs (A>B, A>C)
        assert len(history["alpha"]) == 2

    def test_skips_malformed_lines(self, isolated_data_dir):
        # Manually plant a bad line in the JSONL
        rdir = Path(isolated_data_dir) / "rankings"
        rdir.mkdir(parents=True)
        path = rdir / "matches.jsonl"
        path.write_text(
            'not-json\n'
            '{"ts": "t", "winner": "a", "loser": "b"}\n'
            '{"missing": "fields"}\n'
        )
        history = rankings_storage.replay_history()
        # Only the valid record contributed
        assert set(history.keys()) == {"a", "b"}
        assert len(history["a"]) == 1
