from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_memberships_require_authentication():
    assert client.get("/api/me").status_code == 401


def _signed_token(key, issuer, **claims):
    import time
    from uuid import uuid4
    import jwt
    now = int(time.time())
    payload = {"sub": str(uuid4()), "aud": "authenticated", "iss": issuer, "iat": now, "exp": now + 3600, **claims}
    return jwt.encode(payload, key, algorithm="ES256")


def test_fresh_token_survives_small_clock_difference(monkeypatch):
    """Regression: a token issued a few seconds 'in the future' (Supabase clock ahead) was rejected right after OTP."""
    import time
    import pytest
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import HTTPException
    from fastapi.security import HTTPAuthorizationCredentials
    from app import main

    key = ec.generate_private_key(ec.SECP256R1())
    other = ec.generate_private_key(ec.SECP256R1())
    issuer = "https://project.example/auth/v1"
    monkeypatch.setattr(main.settings(), "supabase_url", "https://project.example")
    monkeypatch.setattr(main, "jwks", lambda _: type("J", (), {"get_signing_key_from_jwt": lambda self, t: type("K", (), {"key": key.public_key()})()})())
    check = lambda token: main.actor_id(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))
    now = int(time.time())

    assert check(_signed_token(key, issuer, iat=now + 5))  # small skew: accepted
    for bad in (_signed_token(other, issuer),                           # wrong signing key
                _signed_token(key, "https://evil.example/auth/v1"),     # wrong issuer
                _signed_token(key, issuer, aud="anon"),                  # wrong audience
                _signed_token(key, issuer, exp=now - 3600),              # long expired
                _signed_token(key, issuer, iat=now + 600)):              # far in the future
        with pytest.raises(HTTPException) as error:
            check(bad)
        assert error.value.status_code == 401


def test_retired_question_routes_are_unavailable():
    from app.main import app
    paths = app.openapi()["paths"]
    assert not any("/questions" in path or "/answers" in path for path in paths)


def test_browser_may_send_every_method_the_api_uses():
    """The browser preflights PUT and DELETE; a missing method blocks the request before it reaches the API."""
    from fastapi.testclient import TestClient
    from app.main import app, settings
    client = TestClient(app)
    for method in ("GET", "POST", "PUT", "DELETE"):
        response = client.options("/api/organizations/x/internships/y/plans/z", headers={
            "Origin": settings().frontend_origin, "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "authorization,content-type"})
        assert response.status_code == 200, method
