"""Checks the AI proposal against the context it was given and keeps only what that context supports."""
import json
from uuid import UUID

from pydantic import ValidationError

from app.core.ai_provider import ProviderError
from app.plans.schemas import (MAX_TASK_HOURS, Draft, DraftNotes, DraftTask, Evidence, GenerateInput,
                               ItemNote, Proposal, Workload)


def _key(title: str) -> str:
    return " ".join(title.casefold().split())


def validate_proposal(raw: str, context: dict, data: GenerateInput) -> tuple[Draft, DraftNotes, Workload, list[str]]:
    """Parse model output and keep only what the context supports. Raises ProviderError when unusable."""
    try:
        proposal = Proposal.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError, TypeError):
        raise ProviderError(502, "The AI draft was not in the expected format. Try again.") from None

    warnings: list[str] = []
    open_tasks, done_tasks = context["open"], context["done"]
    known = {**open_tasks, **done_tasks}

    def evidence(refs: list[str]) -> list[Evidence]:
        rows = [known[ref] for ref in dict.fromkeys(refs) if ref in known]
        return [Evidence(task_id=row["id"], title=row["title"], version=row["version"],
                         review=row["decision"]) for row in rows]

    def hours(value: float | None, label: str) -> float | None:
        if value is None:
            return None
        if not 0 < value <= MAX_TASK_HOURS:
            warnings.append(f"Ignored an unrealistic estimate of {value:g} hours for “{label}”.")
            return None
        return round(value * 2) / 2  # half-hour steps

    def confirm(items: list[Evidence], estimate: float | None) -> list[str]:
        checks = []
        if not items:
            checks.append("No task evidence cited: confirm this is needed.")
        if estimate is None:
            checks.append("No hour estimate: add one or confirm the workload.")
        return checks

    carry: list[UUID] = []
    carry_notes: dict[str, ItemNote] = {}
    for item in proposal.carry:
        row = open_tasks.get(item.task_ref)
        if row is None:
            warnings.append("Ignored a carried task the AI referenced that is not open in this internship.")
            continue
        if row.get("status") == "submitted":
            warnings.append(f"“{row['title']}” is awaiting review. Review it before assigning follow-up work.")
            continue
        if row["id"] in carry:
            continue
        carry.append(row["id"])
        # Carrying a task is evidence in itself; cite its latest review when there is one.
        cited = evidence([item.task_ref, *item.evidence_refs])
        estimate = hours(item.remaining_hours, row["title"])
        if estimate is None and row["estimated_hours"] is not None:
            estimate = float(row["estimated_hours"])
        carry_notes[str(row["id"])] = ItemNote(reason=item.reason, hours=estimate, evidence=cited,
                                               confirm=[] if estimate is not None else ["No hour estimate for the remaining work."])

    existing = {_key(row["title"]) for row in known.values()}
    seen: set[str] = set()
    linked: set[str | None] = set(context.get("jira_taken", ()))
    new_tasks: list[DraftTask] = []
    new_notes: list[ItemNote] = []
    for task in proposal.new_tasks:
        if not data.starts_on <= task.due_on <= data.ends_on:
            warnings.append(f"Removed “{task.title}”: its deadline {task.due_on.isoformat()} is outside the plan period.")
            continue
        if _key(task.title) in existing or _key(task.title) in seen:
            warnings.append(f"Removed “{task.title}”: it duplicates another task.")
            continue
        seen.add(_key(task.title))
        estimate = hours(task.estimated_hours, task.title)
        cited = evidence(task.evidence_refs)
        jira_key = task.jira_key
        if jira_key and (jira_key not in context.get("jira_open", ()) or jira_key in linked):
            warnings.append(f"Removed the Jira link {jira_key} from “{task.title}”: it is not an open issue of the project, or it is already used.")
            jira_key = None
        linked.add(jira_key)
        new_tasks.append(DraftTask(title=task.title, criteria=task.criteria, due_on=task.due_on, estimated_hours=estimate,
                                   jira_key=jira_key))
        new_notes.append(ItemNote(reason=task.reason, hours=estimate, evidence=cited, confirm=confirm(cited, estimate)))

    if not carry and not new_tasks:
        raise ProviderError(502, "The AI draft had no usable tasks for this period. Try again or write the plan manually.")
    estimates = [note.hours for note in [*carry_notes.values(), *new_notes]]
    known_hours = sum(value for value in estimates if value is not None)
    workload = Workload(budget=data.total_hours, known_hours=known_hours,
                        unknown_count=sum(value is None for value in estimates),
                        over_budget=data.total_hours is not None and known_hours > data.total_hours)
    draft = Draft(title=proposal.title, goal=proposal.goal, project=data.project,
                  starts_on=data.starts_on, ends_on=data.ends_on, carry=carry, new_tasks=new_tasks)
    return draft, DraftNotes(carry=carry_notes, new_tasks=new_notes), workload, list(dict.fromkeys(warnings))
