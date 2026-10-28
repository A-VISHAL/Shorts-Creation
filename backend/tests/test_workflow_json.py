"""Automated validation of n8n export JSON structure and node connections."""

import json
from pathlib import Path


def test_n8n_workflow_json_validity():
    workflow_path = Path(__file__).resolve().parent.parent.parent / "n8n" / "motivational-shorts-workflow.json"
    assert workflow_path.is_file(), f"Workflow file not found at {workflow_path}"

    with open(workflow_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert "nodes" in data
    assert "connections" in data
    assert len(data["nodes"]) >= 7

    node_names = {node["name"] for node in data["nodes"]}
    assert "Webhook — Generate Short" in node_names
    assert "Validate Input" in node_names
    assert "Download Source Video" in node_names
    assert "Download Soundtrack" in node_names
    assert "Prepare Render Payload" in node_names
    assert "Render Short (FFmpeg)" in node_names

    # Check connections refer only to existing nodes
    connections = data["connections"]
    for source_node_name, routes in connections.items():
        assert source_node_name in node_names, f"Unknown source node: {source_node_name}"
        for route_type, target_lists in routes.items():
            for target_list in target_lists:
                for target in target_list:
                    assert target["node"] in node_names, f"Unknown target node in connection: {target['node']}"

    # Verify webhook node path
    webhook_node = next(n for n in data["nodes"] if n["name"] == "Webhook — Generate Short")
    assert webhook_node["parameters"]["path"] == "generate-motivational-short"
    assert webhook_node["parameters"]["httpMethod"] == "POST"

    # Verify no real secret credentials are leaked in file
    content = workflow_path.read_text(encoding="utf-8")
    assert "sk-" not in content
    assert "eyJ" not in content  # JWT tokens
