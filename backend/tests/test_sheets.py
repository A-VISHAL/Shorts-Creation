"""Unit tests for Google Sheets integration endpoints."""

import pytest
from fastapi.testclient import TestClient
from app import app
from sheets_service import extract_spreadsheet_id_and_gid, sheets_service


@pytest.fixture
def client():
    return TestClient(app)


def test_extract_spreadsheet_id_and_gid():
    url = "https://docs.google.com/spreadsheets/d/1NyBnzZRfEkq1uPz7JXFm38ZtH8cBvW8dk006xJizQSo/edit?gid=604247059#gid=604247059"
    sheet_id, gid = extract_spreadsheet_id_and_gid(url)
    assert sheet_id == "1NyBnzZRfEkq1uPz7JXFm38ZtH8cBvW8dk006xJizQSo"
    assert gid == 604247059

    raw_id = "1NyBnzZRfEkq1uPz7JXFm38ZtH8cBvW8dk006xJizQSo"
    sheet_id2, gid2 = extract_spreadsheet_id_and_gid(raw_id)
    assert sheet_id2 == raw_id
    assert gid2 is None


def test_sheets_auth_status_endpoint(client):
    resp = client.get("/api/sheets/auth-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "configured" in data
    assert "serviceAccountEmail" in data
    assert "instructions" in data


def test_sheets_inspect_private_without_creds(client):
    url = "https://docs.google.com/spreadsheets/d/1NyBnzZRfEkq1uPz7JXFm38ZtH8cBvW8dk006xJizQSo/edit?gid=604247059#gid=604247059"
    resp = client.post("/api/sheets/inspect", json={"spreadsheetUrl": url})
    # Should return either 403 or 400 when private without creds, with helpful error message
    assert resp.status_code in [400, 403]
    data = resp.json()
    assert data["success"] is False
    assert "Cannot access" in data["error"] or "Permission" in data["error"]


def test_auto_detect_mapping():
    headers = [
        "Quote Text",
        "Background Video Link",
        "Background Music",
        "Short Title",
        "Render Status",
        "Output URL",
    ]
    mapping = sheets_service.auto_detect_mapping(headers)
    assert mapping["quote"] == "Quote Text"
    assert mapping["video_url"] == "Background Video Link"
    assert mapping["music_url"] == "Background Music"
    assert mapping["title"] == "Short Title"
    assert mapping["status"] == "Render Status"
    assert mapping["output_url"] == "Output URL"
