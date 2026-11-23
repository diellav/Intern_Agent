"""Shapes for AI plan drafts: the request, what the model may return, and what the editor receives."""
from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GenerateInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    starts_on: date
    ends_on: date
    goal: str = Field(min_length=1, max_length=1000)  # the focus for the period
    total_hours: float | None = Field(default=None, gt=0, le=1000)
    project: str = Field(default="", max_length=120)
    schedule_notes: str = Field(default="", max_length=300)
    instructions: str = Field(default="", max_length=500)
    availability: str = Field(default="", max_length=300)  # older clients


MAX_TASK_HOURS = 200


class ProposedCarry(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    task_ref: str = Field(max_length=100)  # unknown refs are dropped later, not rejected here
    reason: str = Field(min_length=1, max_length=500)
    remaining_hours: float | None = None
    evidence_refs: list[str] = Field(default_factory=list, max_length=10)


class ProposedTask(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    criteria: str = Field(min_length=1, max_length=3000)
    due_on: date
    reason: str = Field(min_length=1, max_length=500)
    estimated_hours: float | None = None
    evidence_refs: list[str] = Field(default_factory=list, max_length=10)


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=3000)
    carry: list[ProposedCarry] = Field(max_length=30)
    new_tasks: list[ProposedTask] = Field(max_length=30)

    @model_validator(mode="after")
    def has_work(self):
        if not self.carry and not self.new_tasks:
            raise ValueError("A plan needs at least one task.")
        return self


class DraftTask(BaseModel):
    title: str
    criteria: str
    due_on: date
    estimated_hours: float | None = None


class Draft(BaseModel):
    title: str
    goal: str
    project: str
    starts_on: date
    ends_on: date
    carry: list[UUID]
    new_tasks: list[DraftTask]


class Evidence(BaseModel):
    task_id: UUID
    title: str
    version: int | None  # submission version the evidence comes from, when there is one
    review: str | None


class ItemNote(BaseModel):
    reason: str
    hours: float | None
    evidence: list[Evidence]
    confirm: list[str]  # what the mentor should check before approving


class DraftNotes(BaseModel):
    carry: dict[str, ItemNote]
    new_tasks: list[ItemNote]


class Workload(BaseModel):
    budget: float | None
    known_hours: float
    unknown_count: int
    over_budget: bool


class GeneratedDraft(BaseModel):
    draft: Draft
    notes: DraftNotes
    workload: Workload
    warnings: list[str]
    model: str


def proposal_schema(open_refs: list[str]) -> dict:
    ref = {"type": "string", "enum": open_refs} if open_refs else {"type": "string"}
    hours = {"type": ["number", "null"]}
    refs = {"type": "array", "items": {"type": "string"}}
    item = lambda props: {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}  # noqa: E731
    return item({
        "title": {"type": "string"},
        "goal": {"type": "string"},
        "carry": {"type": "array", "items": item({"task_ref": ref, "reason": {"type": "string"},
                                                 "remaining_hours": hours, "evidence_refs": refs})},
        "new_tasks": {"type": "array", "items": item({
            "title": {"type": "string"},
            "criteria": {"type": "string"},
            "due_on": {"type": "string", "description": "YYYY-MM-DD"},
            "reason": {"type": "string"},
            "estimated_hours": hours,
            "evidence_refs": refs,
        })},
    })


class Suggestion(BaseModel):
    focus: str
    source: str
    task_id: UUID
    version: int | None
