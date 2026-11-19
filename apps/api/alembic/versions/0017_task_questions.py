from alembic import op

revision = "0017_task_questions"
down_revision = "0016_progress_reports"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("alter table app.questions add column task_id uuid references app.tasks(id)")
    op.execute("create index questions_task on app.questions(task_id) where task_id is not null")
    op.execute("""
        create policy question_task_scope on app.questions as restrictive
        for all to internagent_runtime using (
            task_id is null or exists (
                select 1 from app.tasks t join app.internships i on i.id=t.internship_id
                where t.id=questions.task_id and i.org_id=questions.org_id
            )
        )
    """)
    op.execute("""
        create policy answer_question_scope on app.answers as restrictive
        for all to internagent_runtime using (
            exists (select 1 from app.questions q where q.id=answers.question_id and q.org_id=answers.org_id)
        )
    """)


def downgrade():
    op.execute("drop policy answer_question_scope on app.answers")
    op.execute("drop policy question_task_scope on app.questions")
    op.execute("alter table app.questions drop column task_id")
