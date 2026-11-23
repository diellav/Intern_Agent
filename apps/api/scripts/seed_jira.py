"""Fill a test Jira Cloud project with a fictional HR platform ("PeopleHub"), for trying the Jira integration.

Fictional data only. Reads JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY from apps/api/.env and
never prints the token. Issues get the label `internagent-seed`; the script stops if they already exist.
Run from apps/api:

    ../../.venv/Scripts/python scripts/seed_jira.py
"""
import sys

import httpx
from dotenv import dotenv_values

SEED_LABEL = "internagent-seed"
TODO, PROGRESS, DONE = "To Do", "In Progress", "Done"

# Text for the InternAgent Projects page (same fictional project).
PROJECT = {
    "name": "PeopleHub",
    "tech_stack": "React, TypeScript, FastAPI, PostgreSQL, Celery, Docker, GitHub Actions",
}

# (epic, epic status, items). Item: (type, summary, status, assigned to you, labels, description, sub-tasks).
# Sub-task: (summary, status, assigned to you).
WORK = [
    ("Employee directory", DONE, [
        ("Story", "Search employees by name, team and skill", DONE, True, ["frontend"],
         "Search box with filters for team and skill; results in under 300 ms for 2,000 employees.",
         [("Search endpoint with trigram index", DONE, True), ("Filter chips in the UI", DONE, True)]),
        ("Story", "Employee profile page", DONE, True, ["frontend"],
         "Profile with role, team, manager, start date and contact details visible to colleagues.", []),
        ("Bug", "Profile photo upload fails for PNG files over 2 MB", DONE, True, ["backend"],
         "Upload returns 500 instead of resizing large images.", []),
    ]),
    ("Leave management", DONE, [
        ("Story", "Request time off with approval by the manager", DONE, True, ["backend", "frontend"],
         "Employees request leave; managers approve or decline; balance updates on approval.",
         [("Leave request form", DONE, True), ("Manager approval queue", DONE, True), ("Email notification on decision", DONE, True)]),
        ("Story", "Team leave calendar", DONE, True, ["frontend"], "Month view of approved leave per team.", []),
        ("Bug", "Leave balance shows negative days after a declined request", PROGRESS, True, ["backend"],
         "Declining a request subtracts the days instead of restoring them.", []),
        ("Bug", "Calendar does not show public holidays for Kosovo", TODO, False, ["frontend", "good-first-issue"],
         "Holidays come from the config file but are not rendered in the team calendar.", []),
    ]),
    ("Onboarding checklists", PROGRESS, [
        ("Story", "HR creates onboarding templates per role", DONE, True, ["backend", "frontend"],
         "Templates with ordered steps, owners (HR, IT, manager) and due offsets in days.", []),
        ("Story", "New hire sees their onboarding checklist", PROGRESS, True, ["frontend"],
         "Checklist on the first login with progress, due dates and who owns each step.",
         [("Checklist page layout", DONE, True), ("Mark step as done", PROGRESS, True), ("Progress bar and empty state", TODO, False)]),
        ("Story", "Reminders for overdue onboarding steps", TODO, False, ["backend"],
         "Daily job sends a reminder to the owner of each overdue step.",
         [("Celery task for overdue steps", TODO, False), ("Reminder email template", TODO, False)]),
        ("Task", "Write tests for the onboarding template API", TODO, False, ["backend", "tests", "good-first-issue"],
         "Cover create, reorder steps, and assign a template to a new hire.", []),
        ("Bug", "Steps lose their order after editing a template", PROGRESS, True, ["backend"],
         "Saving a template reorders steps alphabetically.", []),
    ]),
    ("Recruitment pipeline", PROGRESS, [
        ("Story", "Job postings with an application form", DONE, True, ["backend", "frontend"],
         "HR publishes a posting; candidates apply with CV upload.", []),
        ("Story", "Kanban board of candidates per posting", PROGRESS, True, ["frontend"],
         "Columns: Applied, Screening, Interview, Offer, Hired, Rejected; drag to move.",
         [("Board columns and cards", DONE, True), ("Drag and drop between stages", PROGRESS, True), ("Stage change history", TODO, False)]),
        ("Story", "Interview scheduling with interviewer availability", TODO, False, ["backend"],
         "Pick interviewers, propose slots from their calendars, send invites.", []),
        ("Task", "Add accessibility labels to the candidate board", TODO, False, ["frontend", "accessibility", "good-first-issue"],
         "Cards and columns must be usable with a keyboard and a screen reader.", []),
        ("Bug", "CV preview is blank for DOCX files", TODO, False, ["frontend", "good-first-issue"],
         "PDF previews work; DOCX shows an empty frame.", []),
    ]),
    ("Performance reviews", TODO, [
        ("Story", "Review cycles with self and manager reviews", TODO, False, ["backend", "frontend"],
         "HR opens a cycle; employees write a self review, managers add theirs; both see the result.",
         [("Cycle model and API", TODO, False), ("Self review form", TODO, False), ("Manager review form", TODO, False)]),
        ("Story", "Goals per employee with quarterly check-ins", TODO, False, ["frontend"],
         "Employees set 3-5 goals; managers comment at each check-in.", []),
        ("Task", "Design the review form wireframes", TODO, False, ["design"],
         "Wireframes for self review, manager review and summary pages.", []),
    ]),
    ("Payroll export and reports", TODO, [
        ("Story", "Monthly payroll export as CSV", TODO, False, ["backend"],
         "Export worked days, leave and overtime per employee in the payroll provider's format.", []),
        ("Story", "HR dashboard: headcount, turnover and leave usage", PROGRESS, True, ["frontend"],
         "Charts by month and team; filters for department and date range.",
         [("Headcount chart", DONE, True), ("Turnover chart", TODO, False)]),
        ("Task", "Document the reports API in OpenAPI", TODO, False, ["backend", "docs", "good-first-issue"],
         "Descriptions and examples for every report endpoint.", []),
    ]),
    (None, None, [  # work outside an epic
        ("Task", "Upgrade FastAPI and fix deprecation warnings", TODO, False, ["backend", "maintenance", "good-first-issue"],
         "Bump to the current minor version and fix warnings shown in the test run.", []),
        ("Bug", "Session expires without warning while filling long forms", TODO, False, ["frontend"],
         "Show a warning two minutes before expiry and keep unsaved input.", []),
        ("Task", "Set up end-to-end tests for login and leave request", PROGRESS, True, ["tests"],
         "Playwright tests running in GitHub Actions on every pull request.", []),
    ]),
]


def adf(text: str) -> dict:
    return {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def main() -> None:
    env = dotenv_values(".env")
    missing = [k for k in ("JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY") if not env.get(k)]
    if missing:
        sys.exit("Set " + ", ".join(missing) + " in apps/api/.env.")
    base, key = env["JIRA_BASE_URL"].rstrip("/"), env["JIRA_PROJECT_KEY"]
    with httpx.Client(base_url=base, auth=(env["JIRA_EMAIL"], env["JIRA_API_TOKEN"]), timeout=30) as jira:
        me = jira.get("/rest/api/3/myself")
        if me.status_code != 200:
            sys.exit(f"Jira did not accept the email and token (HTTP {me.status_code}).")
        account = me.json()["accountId"]
        project = jira.get(f"/rest/api/3/project/{key}")
        if project.status_code != 200:
            sys.exit(f"Project {key} not found, or the token cannot see it (HTTP {project.status_code}).")
        types = {t["name"].lower(): t for t in project.json().get("issueTypes", [])}
        subtask = next((t["name"] for t in types.values() if t.get("subtask")), None)
        for needed in ("epic", "story", "task", "bug"):
            if needed not in types:
                sys.exit(f"Project {key} has no '{needed}' issue type. Use a Scrum or Kanban software project.")
        existing = jira.get("/rest/api/3/search/jql", params={"jql": f"project = {key} AND labels = {SEED_LABEL}", "maxResults": 1})
        if existing.status_code == 200 and existing.json().get("issues"):
            sys.exit(f"Project {key} already has seeded issues (label {SEED_LABEL}). Delete them first to seed again.")

        def create(fields: dict) -> str:
            response = jira.post("/rest/api/3/issue", json={"fields": {"project": {"key": key}, **fields}})
            if response.status_code != 201:
                body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                sys.exit(f"Jira refused an issue (HTTP {response.status_code}): {body.get('errors') or body.get('errorMessages')}")
            return response.json()["key"]

        def finish(issue: str, status: str, assigned: bool) -> None:
            if assigned and jira.put(f"/rest/api/3/issue/{issue}/assignee", json={"accountId": account}).status_code != 204:
                print(f"    could not assign {issue}")
            if status == TODO:
                return
            options = jira.get(f"/rest/api/3/issue/{issue}/transitions").json().get("transitions", [])
            match = next((t for t in options if t["to"]["name"].lower() == status.lower()), None)
            if match is None or jira.post(f"/rest/api/3/issue/{issue}/transitions", json={"transition": {"id": match["id"]}}).status_code != 204:
                print(f"    could not move {issue} to {status}")

        count = 0
        for epic, epic_status, items in WORK:
            parent = None
            if epic:
                parent = create({"summary": epic, "issuetype": {"name": types["epic"]["name"]}, "labels": [SEED_LABEL],
                                 "description": adf(f"PeopleHub module: {epic}.")})
                finish(parent, epic_status, False)
                print(f"{parent} [{epic_status}] {epic}")
                count += 1
            for kind, summary, status, assigned, labels, description, subtasks in items:
                fields = {"summary": summary, "issuetype": {"name": types[kind.lower()]["name"]},
                          "labels": [SEED_LABEL, *labels], "description": adf(description)}
                if parent:
                    fields["parent"] = {"key": parent}
                issue = create(fields)
                finish(issue, status, assigned)
                print(f"  {issue} {kind} [{status}]{' (you)' if assigned else ''} {summary}")
                count += 1
                for sub_summary, sub_status, sub_assigned in subtasks if subtask else []:
                    sub = create({"summary": sub_summary, "issuetype": {"name": subtask}, "parent": {"key": issue},
                                  "labels": [SEED_LABEL]})
                    finish(sub, sub_status, sub_assigned)
                    print(f"    {sub} Sub-task [{sub_status}] {sub_summary}")
                    count += 1
        print(f"Created {count} issues in {key}.")


if __name__ == "__main__":
    main()
