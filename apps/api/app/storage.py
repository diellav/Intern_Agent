"""Server-side access to the private Supabase Storage bucket for submission files.

Only the backend holds the secret key. Browsers never get a storage credential, only short-lived
signed URLs for objects they are allowed to read.
"""
import logging
from typing import Protocol
from urllib.parse import quote

import httpx

from app.main import settings

log = logging.getLogger("internagent.storage")
BUCKET = "submission-files"
SIGNED_URL_SECONDS = 300


class StorageError(Exception):
    pass


class Storage(Protocol):
    def put(self, path: str, data: bytes, content_type: str) -> None: ...
    def signed_url(self, path: str, file_name: str) -> str: ...
    def remove(self, paths: list[str]) -> None: ...


class SupabaseStorage:
    def __init__(self, base_url: str, secret_key: str, client: httpx.Client | None = None):
        self._base = base_url.rstrip("/") + "/storage/v1"
        self._key = secret_key
        self._client = client or httpx.Client(timeout=30)

    def _headers(self, extra: dict | None = None) -> dict:
        headers = {"apikey": self._key}
        if self._key.startswith("eyJ"):  # legacy service_role JWT; new sb_secret_ keys go in apikey only
            headers["Authorization"] = f"Bearer {self._key}"
        return {**headers, **(extra or {})}

    def _object(self, path: str) -> str:
        return f"{BUCKET}/{quote(path)}"

    def put(self, path: str, data: bytes, content_type: str) -> None:
        response = self._client.post(f"{self._base}/object/{self._object(path)}", content=data,
                                     headers=self._headers({"Content-Type": content_type, "x-upsert": "false"}))
        if response.status_code not in (200, 201):
            log.warning("Storage upload failed: HTTP %s", response.status_code)
            raise StorageError("upload")

    def signed_url(self, path: str, file_name: str) -> str:
        response = self._client.post(f"{self._base}/object/sign/{self._object(path)}",
                                     json={"expiresIn": SIGNED_URL_SECONDS}, headers=self._headers())
        if response.status_code != 200:
            log.warning("Storage signing failed: HTTP %s", response.status_code)
            raise StorageError("sign")
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        if not signed:
            raise StorageError("sign")
        return f"{self._base}{signed}&download={quote(file_name)}"

    def remove(self, paths: list[str]) -> None:
        if not paths:
            return
        response = self._client.request("DELETE", f"{self._base}/object/{BUCKET}", json={"prefixes": paths},
                                        headers=self._headers())
        if response.status_code not in (200, 204):
            log.warning("Storage delete failed: HTTP %s", response.status_code)
            raise StorageError("remove")


def file_storage() -> Storage | None:
    config = settings()
    if not config.supabase_url or not config.supabase_secret_key:
        return None
    return SupabaseStorage(config.supabase_url, config.supabase_secret_key)
