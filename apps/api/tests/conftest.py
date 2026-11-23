import pytest

from app.main import settings


@pytest.fixture(autouse=True)
def no_live_jira(monkeypatch):
    """Tests never call the Jira site configured in .env; Jira tests opt in with their own fake client."""
    monkeypatch.setattr(settings(), "jira_base_url", "")
