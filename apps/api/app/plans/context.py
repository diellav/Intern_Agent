"""The internship context sent to the AI, read under the mentor's row-level security scope."""
from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app.core.ai_provider import clip
from app.plans.crud import plan_parent
from app.plans.schemas import GenerateInput
from app.jira.sync import project_ai_context

MAX_OPEN_TASKS = 30
MAX_DONE_TASKS = 10


def _tasks(connection, internship_id: UUID):
    return connection.execute(text("""
        select t.id, t.title, t.criteria, t.due_on, t.status, t.estimated_hours,
            s.version, s.decision, s.feedback, s.submitted_at::date as submitted_on
        from app.tasks t
        left join lateral (
            select version, decision, feedback, submitted_at from app.submissions
            where task_id=t.id order by version desc limit 1
        ) s on true
        where t.internship_id=:id
        order by (t.status = 'completed'), t.due_on, t.id
    """), {"id": internship_id}).mappings().all()


def shared_notes(connection, internship_id: UUID) -> list[dict]:
    """Notes the intern can also see. Private mentor notes never go to the model."""
    if connection.execute(text("select to_regclass('app.internship_notes')")).scalar() is None:
        return []
    rows = connection.execute(text("""
        select body, created_at::date as on_date from app.internship_notes
        where internship_id=:id and visibility='shared' order by created_at desc limit 5
    """), {"id": internship_id}).mappings().all()
    return [{"note": clip(row["body"], 300), "date": row["on_date"].isoformat()} for row in rows]


def collect_context(connection, org_id: UUID, internship_id: UUID, actor: UUID, data: GenerateInput) -> dict:
    """Context for one internship, read under the mentor's row-level security scope."""
    parent = plan_parent(connection, org_id, internship_id, actor)
    if not parent["starts_on"] <= data.starts_on <= data.ends_on <= parent["ends_on"]:
        raise HTTPException(422, "The plan dates must fall within the internship.")
    program = connection.execute(text("select name, description from app.programs where id=:id"),
                                 {"id": parent["program_id"]}).mappings().one()
    rows = _tasks(connection, internship_id)
    open_rows = [row for row in rows if row["status"] != "completed"][:MAX_OPEN_TASKS]
    done_rows = sorted((row for row in rows if row["status"] == "completed"),
                       key=lambda row: row["due_on"], reverse=True)[:MAX_DONE_TASKS]
    plans = connection.execute(text("""
        select title, starts_on, ends_on from app.plans
        where internship_id=:id and published_at is not null order by starts_on desc limit 3
    """), {"id": internship_id}).mappings().all()
    notes = shared_notes(connection, internship_id)
    starting_profile = None
    if not plans:
        analysis = connection.execute(text(
            "select analysis from app.intern_cvs where internship_id=:id"
        ), {"id": internship_id}).scalar()
        if isinstance(analysis, dict):
            starting_profile = {
                "learn_first": analysis.get("learn_first", [])[:10],
                "starter_tasks": analysis.get("starter_tasks", [])[:5],
            }

    def task(ref: str, row) -> dict:
        latest = None
        if row["version"] is not None:
            latest = {"version": row["version"], "submitted_on": row["submitted_on"].isoformat(),
                      "review": row["decision"] or "awaiting review",
                      "mentor_feedback": clip(row["feedback"], 400)}
        return {"ref": ref, "title": row["title"], "criteria": clip(row["criteria"], 500),
                "due_on": row["due_on"].isoformat(), "status": row["status"],
                "estimated_hours": float(row["estimated_hours"]) if row["estimated_hours"] is not None else None,
                "latest_submission": latest}

    open_tasks = {f"T{i}": row for i, row in enumerate(open_rows, 1)}
    done_tasks = {f"C{i}": row for i, row in enumerate(done_rows, 1)}
    requested = {"starts_on": data.starts_on.isoformat(), "ends_on": data.ends_on.isoformat(),
                 "days": (data.ends_on - data.starts_on).days + 1, "focus": data.goal,
                 "total_hours_available": data.total_hours, "project": data.project or None,
                 "schedule_constraints": data.schedule_notes or data.availability or None,
                 "mentor_instructions": data.instructions or None, "today": date.today().isoformat()}
    project = project_ai_context(connection, parent["project_id"])
    issues = (project or {}).get("open_jira_issues", [])
    # Jira issues the intern already has a task for are not offered again.
    taken = {row[0] for row in connection.execute(text(
        "select jira_key from app.tasks where internship_id=:id and jira_key is not null"), {"id": internship_id})}
    if project:
        project["open_jira_issues"] = [issue for issue in issues if issue["key"] not in taken]
    return {
        "jira_open": {issue["key"] for issue in issues},
        "jira_taken": taken,
        "open": open_tasks,
        "done": done_tasks,
        "payload": {
            "internship": {"program": program["name"], "program_description": clip(program["description"], 400),
                           "starts_on": parent["starts_on"].isoformat(), "ends_on": parent["ends_on"].isoformat()},
            # The company project the intern joins: new work should come from it, not from invented exercises.
            "project": project,
            "requested_plan": requested,
            "planning_stage": "next_period" if plans else "first_plan",
            "starting_profile": starting_profile,
            "open_tasks": [task(ref, row) for ref, row in open_tasks.items()],
            "completed_tasks": [task(ref, row) for ref, row in done_tasks.items()],
            "recent_published_plans": [{"title": p["title"], "starts_on": p["starts_on"].isoformat(),
                                        "ends_on": p["ends_on"].isoformat()} for p in plans],
            "shared_notes": notes,
        },
    }
