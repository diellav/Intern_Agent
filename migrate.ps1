$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv/Scripts/python.exe'
Push-Location (Join-Path $root 'apps/api')
try {
@'
import os
from dotenv import dotenv_values
from alembic import command
from alembic.config import Config

values = dotenv_values(".env")
if not values.get("MIGRATION_DATABASE_URL"):
    print("Set MIGRATION_DATABASE_URL in apps/api/.env.")
    raise SystemExit(1)
os.environ["MIGRATION_DATABASE_URL"] = values["MIGRATION_DATABASE_URL"]
try:
    command.upgrade(Config("alembic.ini"), "head")
except Exception as exc:
    error = getattr(exc, "orig", exc)
    print("Migration failed:", type(error).__name__, getattr(error, "sqlstate", "") or "")
    raise SystemExit(1) from None
print("InternAgent database is up to date.")
'@ | & $python -B -
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
