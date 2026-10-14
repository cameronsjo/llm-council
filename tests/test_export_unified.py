"""Council exports preserve current, partial, and migrated conversation data."""

import copy

import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.auth import get_optional_user
from backend.export import export_to_markdown
from backend.main import app


def council_message(unified: bool) -> dict:
    if unified:
        return {
            "role": "assistant",
            "mode": "council",
            "rounds": [
                {
                    "round_type": "responses",
                    "responses": [{"model": "test/member", "content": "Individual answer"}],
                },
                {
                    "round_type": "rankings",
                    "responses": [
                        {
                            "model": "test/evaluator",
                            "content": "Peer evaluation",
                            "parsed_ranking": ["Response A"],
                        }
                    ],
                },
            ],
            "synthesis": {"model": "test/chair", "content": "Final answer"},
        }
    return {
        "role": "assistant",
        "stage1": [{"model": "test/member", "response": "Individual answer"}],
        "stage2": [
            {
                "model": "test/evaluator",
                "ranking": "Peer evaluation",
                "parsed_ranking": ["Response A"],
            }
        ],
        "stage3": {"model": "test/chair", "response": "Final answer"},
    }


@pytest.mark.parametrize("unified", [False, True])
def test_full_council_export(unified: bool) -> None:
    conversation = {"messages": [council_message(unified)]}
    before = copy.deepcopy(conversation)
    markdown = export_to_markdown(conversation)
    for text in [
        "Individual answer",
        "Peer evaluation",
        "Final answer",
        "member",
        "evaluator",
        "chair",
        "**Extracted Ranking:** Response A",
    ]:
        assert text in markdown
    assert conversation == before


@pytest.mark.parametrize("unified", [False, True])
def test_download_exports_real_storage_migration(tmp_path, monkeypatch, unified: bool) -> None:
    monkeypatch.setattr(storage, "DATA_DIR", str(tmp_path))
    conversation = {
        "id": "export-test",
        "title": "Council export",
        "messages": [council_message(unified)],
    }
    storage.save_conversation(conversation)
    assert "rounds" in storage.get_conversation("export-test")["messages"][0]
    original = dict(app.dependency_overrides)
    app.dependency_overrides[get_optional_user] = lambda: None
    try:
        with TestClient(app) as client:
            response = client.get("/api/conversations/export-test/export/markdown")
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "attachment" in response.headers["content-disposition"]
    for text in ["Individual answer", "Peer evaluation", "Final answer"]:
        assert text in response.text


@pytest.mark.parametrize("shape", ["responses", "rankings", "synthesis", "reversed", "singular"])
def test_partial_and_typed_rounds(shape: str) -> None:
    message = council_message(True)
    if shape == "responses":
        message["rounds"] = message["rounds"][:1]
        message["synthesis"] = None
        expected = "Individual answer"
    elif shape == "rankings":
        message["rounds"] = message["rounds"][1:]
        message["synthesis"] = None
        expected = "Peer evaluation"
    elif shape == "synthesis":
        message["rounds"] = []
        expected = "Final answer"
    else:
        if shape == "reversed":
            message["rounds"].reverse()
        else:
            message["rounds"][1]["round_type"] = "ranking"
        expected = "Peer evaluation"
    assert expected in export_to_markdown({"messages": [message]})
