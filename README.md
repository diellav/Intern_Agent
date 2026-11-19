# InternAgent

Foundation for an invite-only internship and mentorship workspace. The first screen shows real organization memberships from Supabase through FastAPI.

## Set up Supabase

1. Create a development project. Configure an asymmetric signing key under Auth and invite your test user. Set Site URL and an allowed redirect to `http://localhost:5173`. Disable public signups before inviting pilot users.
2. Copy `apps/web/.env.example` and `apps/api/.env.example` to `.env` in their respective directories. Set the project URL in both and its publishable key in the frontend only. Use the migration connection from the Supabase Connect dialog. Use the session pooler if the direct database endpoint is unreachable over IPv4.
3. Create the restricted runtime role in the SQL Editor. Replace the placeholder with a generated password, and URL-encode it when putting it in the connection string. Use the runtime role for `DATABASE_URL` and the migration role for `MIGRATION_DATABASE_URL`. For the shared session pooler use the username format `internagent_runtime.PROJECT_REF`.

```sql
create role internagent_runtime login password 'REPLACE_WITH_GENERATED_PASSWORD'
  nosuperuser nocreatedb nocreaterole nobypassrls;
```

From the repo root, install dependencies if needed and apply the schema.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/api/requirements-dev.txt
npm.cmd --prefix apps/web install
Set-Location apps/api
& ..\..\.venv\Scripts\python.exe -m alembic upgrade head
```

In the Supabase SQL Editor, give your invited user the first membership.

```sql
insert into app.organizations (slug, name) values ('anchorzup', 'AnchorzUp');
insert into app.memberships (org_id, user_id, role)
select o.id, u.id, 'admin'
from app.organizations o cross join auth.users u
where o.slug = 'anchorzup' and u.email = 'YOUR_INVITED_EMAIL';
```

## Run

In one terminal from the repository root:

```powershell
Set-Location apps/api
& ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

In another terminal from the repository root:

```powershell
npm.cmd --prefix apps/web run dev
```

Open http://localhost:5173. API health is available at http://localhost:8000/health.

## Verify

Run `python -m pytest` from `apps/api` with the repository virtual environment. Run `npm.cmd --prefix apps/web run build` from the repository root.

## Try the internship workflow

In Supabase Authentication → Users, invite one mentor and one intern with separate email addresses. After they appear in the users list, run this in the SQL Editor. Replace the two example emails and use the slug of your test organization.

```sql
insert into app.memberships (org_id, user_id, role)
select o.id, u.id, invited.role
from (values ('mentor@example.test', 'mentor'), ('intern@example.test', 'intern')) as invited(email, role)
join auth.users u on lower(u.email) = lower(invited.email)
cross join app.organizations o
where o.slug = 'anchorzup'
on conflict (org_id, user_id) do nothing
returning role;
```

The result should include one mentor and one intern. An account already assigned another role is preserved.

1. Sign in as Admin. Create a program under **Programs**, then create an assignment under **Internships**.
2. Sign in as Mentor. Open the assignment and create a task with acceptance criteria and a deadline.
3. Sign in as Intern. Open the task and submit a written deliverable or link.
4. Sign in as Mentor. Review the current version and approve it or request changes. The intern can resubmit after a change request. Earlier versions and feedback remain in the history.

The optional integration test creates synthetic data within a PostgreSQL transaction and rolls it back. Run it against a development Supabase project after applying migrations.

```powershell
Set-Location apps/api
$env:INTERNAGENT_DB_TEST = '1'
& ..\..\.venv\Scripts\python.exe -m pytest
```


## Apply database updates

From the Intern_Agent root, run:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\migrate.ps1

This applies pending Alembic revisions using MIGRATION_DATABASE_URL from apps/api/.env. Organization and Auth memberships are setup data. Supabase invitations are managed in Auth, separately from schema migrations.

## AI plan drafts (Groq)

Mentors can ask for a plan draft from an internship's **Plan** section. The backend reads only that internship's dates, open tasks, criteria and latest reviews, sends them to Groq, and validates the answer. Carried tasks must be open tasks it offered, deadlines must fall within the plan, and duplicates are removed with a visible warning. The draft opens in the normal plan editor. Nothing is saved until the mentor clicks **Save draft**, and nothing is assigned until **Approve and assign**.

Add these to `apps/api/.env` (names are in `.env.example`). The key stays on the server.

```
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
```

`openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` and `meta-models/muse-spark-open` use strict structured outputs. Other models fall back to JSON mode. The output is validated with Pydantic in every case. Optional: `GROQ_TIMEOUT_SECONDS` (default 45). Without a key and model, **Generate draft** is disabled and plans are written manually.

Apply migration `0007_internship_people` with `.\migrate.ps1` before running this version. It adds a read-only function that shows mentor and intern emails within the existing access rules.

Tests: `python -m pytest` runs the planner tests with a fake provider. Add `INTERNAGENT_DB_TEST=1` to also run the rollback tests against the development database, including generate → edit → save → publish → intern view.

## Files, notes and review suggestions

Apply migrations `0008`–`0010` with `.\migrate.ps1`. They add task hour estimates, a notice when a plan is published, submission files and links, internship notes, and a private Storage bucket `submission-files` (10 MB, allowed types only). Existing submissions keep working; their description shows as before.

File uploads need the project's secret key on the server only. Add it to `apps/api/.env` (Supabase → Project Settings → API Keys → Secret key) and restart the API:

```
SUPABASE_SECRET_KEY=
```

Without it, interns can still submit a description and links, and the form says uploads are not set up. Files are stored privately; mentors open them through 5-minute signed links after a permission check.

Notes live under each internship. Private notes are visible only to their author. Shared notes are visible to the intern and admins, and only shared notes are sent to AI plan drafts. Review suggestions read a version's description, link titles and hosts, and file names. File contents and linked pages are never sent.

Rollback tests against the development database: `tests/test_workflow.py` (plans, publish, notices), `tests/test_files.py` (files, links, versions, access, review suggestions) and `tests/test_notes.py` (note visibility). Run them with `INTERNAGENT_DB_TEST=1 python -m pytest` from `apps/api`.

## Display names

Migrations `0011`–`0012` add `app.profiles` for display names. Names are shown only to people who can already see the record, and they never affect identity or access. Each user can set their own name from the user menu (top right). To give the synthetic Sample Workspace users fictional names, run this from `apps/api`. It can be run again safely and never renames real accounts.

```powershell
& ..\..\.venv\Scripts\python.exe seed_sample.py --names
```
