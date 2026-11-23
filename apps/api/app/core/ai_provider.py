"""The AI provider (Groq) shared by every AI feature."""
import logging
from typing import Protocol

import httpx

from app.main import settings

log = logging.getLogger("internagent.ai")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Models that enforce the JSON schema (strict) or follow it on a best-effort basis.
# Source: https://console.groq.com/docs/structured-outputs. Other models fall back to JSON mode.
STRICT_SCHEMA_MODELS = {"openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open"}
SCHEMA_MODELS = STRICT_SCHEMA_MODELS | {"openai/gpt-oss-safeguard-20b"}


class ProviderError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Provider(Protocol):
    model: str

    def complete(self, messages: list[dict], schema: dict) -> str: ...


class GroqProvider:
    def __init__(self, api_key: str, model: str, timeout: float, client: httpx.Client | None = None):
        self._key = api_key
        self.model = model
        self._timeout = timeout
        self._client = client

    def _format(self, schema: dict) -> dict:
        if self.model in SCHEMA_MODELS:
            return {"type": "json_schema", "json_schema": {
                "name": "plan_proposal", "strict": self.model in STRICT_SCHEMA_MODELS, "schema": schema}}
        return {"type": "json_object"}

    def complete(self, messages: list[dict], schema: dict) -> str:
        body = {"model": self.model, "messages": messages, "temperature": 0.2,
                "max_completion_tokens": 6000, "response_format": self._format(schema)}
        client = self._client or httpx.Client()
        try:
            response = client.post(GROQ_URL, json=body, timeout=self._timeout,
                                   headers={"Authorization": f"Bearer {self._key}"})
        except httpx.TimeoutException:
            raise ProviderError(504, "The AI provider did not respond in time. Try again, or write the plan manually.") from None
        except httpx.HTTPError as exc:
            log.warning("Groq request failed: %s", type(exc).__name__)
            raise ProviderError(502, "Could not reach the AI provider. Try again later.") from None
        finally:
            if self._client is None:
                client.close()
        if response.status_code != 200:
            # Never log or return the body: it can echo request content.
            log.warning("Groq returned HTTP %s", response.status_code)
            if response.status_code in (401, 403):
                raise ProviderError(502, "The AI provider rejected the server configuration. Ask an admin to check the Groq key.")
            if response.status_code == 404:
                raise ProviderError(502, "The configured AI model is not available. Ask an admin to check GROQ_MODEL.")
            if response.status_code == 429:
                raise ProviderError(503, "The AI provider is rate limiting requests. Try again in a minute.")
            if response.status_code == 400:
                raise ProviderError(502, "The AI provider could not produce a valid draft. Try again or adjust the goal.")
            raise ProviderError(502, "The AI provider failed to respond. Try again later.")
        try:
            result = response.json()
            self.usage = result.get("usage") or {}
            choice = result["choices"][0]
            content = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError(502, "The AI provider returned an unexpected response.") from None
        if choice.get("finish_reason") == "length":
            raise ProviderError(502, "The AI draft was cut off. Try a shorter period or a narrower goal.")
        if not isinstance(content, str):
            raise ProviderError(502, "The AI provider returned an unexpected response.")
        return content


def planner_provider() -> Provider | None:
    config = settings()
    if not config.groq_api_key or not config.groq_model:
        return None
    return GroqProvider(config.groq_api_key, config.groq_model, config.groq_timeout_seconds)


def clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    return value if len(value) <= limit else value[: limit - 1] + "…"
