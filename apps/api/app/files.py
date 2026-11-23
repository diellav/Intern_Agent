"""Submission attachments: staged upload, attach on submit, signed download."""
import logging
import re
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text

from app.core import deps
from app.routes.tasks import task_scope
from app.main import actor_id
from app.storage import Storage, StorageError, file_storage

router = APIRouter(prefix="/api/organizations/{org_id}")
Actor = Annotated[UUID, Depends(actor_id)]
log = logging.getLogger("internagent.files")

MAX_BYTES = 10 * 1024 * 1024
STAGED_HOURS = 24
# The extension decides the stored content type; the browser's claim is not trusted.
TYPES = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".zip": "application/zip",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
NOT_CONFIGURED = "File uploads are not configured on the server. Add links or a description instead."


def clean_name(name: str) -> str:
    base = PurePath(name.replace("\\", "/")).name.strip()
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)[:200]
    if not base or base in (".", ".."):
        raise HTTPException(422, "The file needs a name.")
    return base


def _storage(storage: Storage | None) -> Storage:
    if storage is None:
        raise HTTPException(503, NOT_CONFIGURED)
    return storage


def _purge_staged(connection, storage: Storage, task_id: UUID, actor: UUID) -> None:
    """Remove this intern's staged files that were never attached to a submission."""
    stale = connection.execute(text(f"""
        delete from app.submission_files where task_id=:task and uploaded_by=:actor and submission_id is null
        and created_at < now() - interval '{STAGED_HOURS} hours' returning storage_path
    """), {"task": task_id, "actor": actor}).scalars().all()
    if stale:
        try:
            storage.remove(list(stale))
        except StorageError:
            log.warning("Could not remove %d stale staged files", len(stale))


def _stage(org_id: UUID, task_id: UUID, actor: UUID, name: str, content_type: str, data: bytes, storage: Storage) -> dict:
    with deps.program_connection(actor, org_id) as c:
        task = task_scope(c, org_id, task_id)
        if task["intern_id"] != actor:
            raise HTTPException(403, "Only the assigned intern can add files.")
        if task["status"] not in ("planned", "changes_requested"):
            raise HTTPException(409, "This task is not accepting a submission.")
        internship = c.execute(text("select internship_id from app.tasks where id=:id"), {"id": task_id}).scalar_one()
        _purge_staged(c, storage, task_id, actor)
        path = f"{org_id}/{internship}/{task_id}/{uuid4()}{PurePath(name).suffix.lower()}"
        try:
            storage.put(path, data, content_type)
        except StorageError:
            raise HTTPException(502, "The file could not be stored. Try again.") from None
        try:
            with c.begin_nested():
                row = c.execute(text("""
                    insert into app.submission_files (task_id, uploaded_by, storage_path, file_name, size_bytes, content_type)
                    values (:task, :actor, :path, :name, :size, :type)
                    returning id, file_name, size_bytes, content_type, created_at
                """), {"task": task_id, "actor": actor, "path": path, "name": name, "size": len(data), "type": content_type}).mappings().one()
        except Exception:
            # Keep storage and database in step: an object without a row would never be cleaned up.
            try:
                storage.remove([path])
            except StorageError:
                log.warning("Could not remove an orphaned upload after a database error")
            raise
        return dict(row)


@router.get("/uploads/status")
def upload_status(org_id: UUID, actor: Actor, storage: Annotated[Storage | None, Depends(file_storage)]):
    with deps.program_connection(actor, org_id):
        pass
    return {"configured": storage is not None, "max_bytes": MAX_BYTES, "extensions": sorted(TYPES)}


@router.post("/tasks/{task_id}/files", status_code=201)
async def upload_file(org_id: UUID, task_id: UUID, actor: Actor, request: Request,
                      name: Annotated[str, Query(max_length=300)],
                      storage: Annotated[Storage | None, Depends(file_storage)]):
    store = _storage(storage)
    file_name = clean_name(name)
    content_type = TYPES.get(PurePath(file_name).suffix.lower())
    if content_type is None:
        raise HTTPException(415, "This file type is not allowed. Use PDF, images, text, Office documents or ZIP.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "The file is larger than 10 MB.")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "The file is larger than 10 MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    return await run_in_threadpool(_stage, org_id, task_id, actor, file_name, content_type, bytes(data), store)


@router.delete("/tasks/{task_id}/files/{file_id}")
def discard_file(org_id: UUID, task_id: UUID, file_id: UUID, actor: Actor,
                 storage: Annotated[Storage | None, Depends(file_storage)]):
    store = _storage(storage)
    with deps.program_connection(actor, org_id) as c:
        task_scope(c, org_id, task_id)
        path = c.execute(text("""
            delete from app.submission_files where id=:id and task_id=:task and submission_id is null and uploaded_by=:actor
            returning storage_path
        """), {"id": file_id, "task": task_id, "actor": actor}).scalar()
        if path is None:
            raise HTTPException(404, "File not found, or it is already part of a submission.")
    try:
        store.remove([path])
    except StorageError:
        log.warning("Discarded file row; storage object will need manual cleanup")
    return {"id": file_id}


@router.get("/files/{file_id}/url")
def file_url(org_id: UUID, file_id: UUID, actor: Actor, storage: Annotated[Storage | None, Depends(file_storage)]):
    store = _storage(storage)
    with deps.program_connection(actor, org_id) as c:
        # Row-level security limits this to files of tasks the actor can read, in this organization.
        row = c.execute(text("""
            select f.storage_path, f.file_name from app.submission_files f
            join app.tasks t on t.id=f.task_id join app.internships i on i.id=t.internship_id
            where f.id=:id and i.org_id=:org
        """), {"id": file_id, "org": org_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "File not found.")
    try:
        return {"url": store.signed_url(row["storage_path"], row["file_name"]), "expires_in": 300}
    except StorageError:
        raise HTTPException(502, "Could not create a download link. Try again.") from None
