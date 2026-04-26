"""Smoke tests for /api/rankings and /api/rankings/history endpoints."""

import pytest
from fastapi.testclient import TestClient

from backend import rankings_storage
from backend.main import app


@pytest.fixture
def isolated_data_dir(tmp_path, monkeypatch):
    """Each test gets a fresh data dir."""
    monkeypatch.setattr(rankings_storage, "DATA_BASE_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client():
    return TestClient(app)


def _record_round(label_to_model, voter_rankings):
    results = [
        {"model": v, "parsed_ranking": labels} for v, labels in voter_rankings
    ]
    return rankings_storage.record_stage2_matches(
        results, label_to_model, conversation_id="test-conv", user_id=None
    )


class TestRankingsEndpoint:
    def test_empty_state_returns_empty_leaderboard(self, isolated_data_dir, client):
        response = client.get("/api/rankings")
        assert response.status_code == 200
        assert response.json() == {"leaderboard": []}

    def test_returns_sorted_leaderboard_after_round(self, isolated_data_dir, client):
        labels = {"Response A": "alpha", "Response B": "beta", "Response C": "gamma"}
        _record_round(labels, [
            ("alpha", ["Response A", "Response B", "Response C"]),
            ("beta", ["Response A", "Response B", "Response C"]),
        ])
        response = client.get("/api/rankings")
        assert response.status_code == 200
        board = response.json()["leaderboard"]
        assert len(board) == 3
        # Alpha has 2 wins, beta has 1 win, gamma has 0 → alpha > beta > gamma
        assert [row["model"] for row in board] == ["alpha", "beta", "gamma"]
        assert [row["rank"] for row in board] == [1, 2, 3]
        # Each row has the documented shape
        assert set(board[0]) == {"model", "rating", "games", "last_updated", "rank"}


class TestRankingsHistoryEndpoint:
    def test_empty_state_returns_empty_history(self, isolated_data_dir, client):
        response = client.get("/api/rankings/history")
        assert response.status_code == 200
        assert response.json() == {"history": {}}

    def test_returns_per_model_series(self, isolated_data_dir, client):
        labels = {"Response A": "alpha", "Response B": "beta"}
        _record_round(labels, [("alpha", ["Response A", "Response B"])])
        response = client.get("/api/rankings/history")
        assert response.status_code == 200
        history = response.json()["history"]
        assert set(history.keys()) == {"alpha", "beta"}
        # One pair recorded → one snapshot per model
        assert len(history["alpha"]) == 1
        assert {"ts", "rating", "games"} <= set(history["alpha"][0])

    def test_model_filter_narrows_response(self, isolated_data_dir, client):
        labels = {"Response A": "alpha", "Response B": "beta", "Response C": "gamma"}
        _record_round(labels, [("alpha", ["Response A", "Response B", "Response C"])])
        response = client.get("/api/rankings/history", params={"model": "alpha"})
        assert response.status_code == 200
        assert set(response.json()["history"].keys()) == {"alpha"}
