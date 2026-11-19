"""Pure unit tests for the CV personal-data scrubber (no database, no network)."""
import pytest
from fastapi import HTTPException

from app.main import app  # noqa: F401  (import first: app.main wires the routers)
from app.cv import CvAnalysis, identity_names, prepare, sanitize_analysis, scrub

ENGLISH = """Blerim Hoxha
Name: Blerim Hoxha
Email: blerim.hoxha@gmail.com | Phone: +383 44 123 456
arta(at)mail(dot)com
Rr. Nena Tereze 12, 10000 Prishtine
LinkedIn: linkedin.com/in/blerimhoxha
GitHub: blerimh
Portfolio https://blerim.dev/projects
Date of birth: 12.03.2001
SKILLS
Python, SQL, Docker, GitHub Actions
EXPERIENCE
Data Intern, Acme LLC, 2019-2023
Worked on email marketing analytics for 10 000 000 records
Backend Developer, Beta Sh.p.k., 2023 – present
Built a REST API in FastAPI; reduced latency by 40%
Call me on 044 123 456 any time
EDUCATION
BSc Computer Science, University of Prishtina, 2019 - 2023
"""

ALBANIAN = """Curriculum Vitae
Arta Krasniqi
Emri: Arta Krasniqi
Tel: 044 123 456
Adresa: Rruga e Durrësit 45, Tiranë
Datëlindja: 01.02.2000
Profili
Studente e Shkencave Kompjuterike me interes për zhvillimin web.
Aftësitë
JavaScript, React, Node.js, PostgreSQL
Përvoja
Praktikante në ABC Sh.p.k. (2021 – 2022): ndërtova faqe me React.
Projekte: aplikacion për menaxhimin e detyrave, 2022
Kontakt: arta.krasniqi(at)mail.com, +355 69 123 4567
"""

SUMMARY_FIRST = """Motivated junior developer with three years of Python experience.
Skills: Python, Pandas, scikit-learn
Experience: 2020-2022 Analyst at Gamma; built dashboards for 1 500 users
"""


def test_keeps_skills_experience_education_and_year_ranges():
    out = scrub(ENGLISH)
    for kept in ["SKILLS", "Python, SQL, Docker, GitHub Actions", "EXPERIENCE", "Data Intern, Acme LLC, 2019-2023",
                 "Worked on email marketing analytics for 10 000 000 records", "2023 – present",
                 "Built a REST API in FastAPI; reduced latency by 40%", "EDUCATION",
                 "BSc Computer Science, University of Prishtina, 2019 - 2023"]:
        assert kept in out


def test_replaces_contact_details_in_english_cv():
    out = scrub(ENGLISH)
    for leaked in ["Blerim", "Hoxha", "blerim.hoxha", "gmail", "arta", "mail(dot)com", "+383", "44 123 456",
                   "044 123 456", "Nena Tereze", "10000", "blerimh", "blerim.dev", "12.03.2001"]:
        assert leaked.lower() not in out.lower(), leaked
    assert "Name: [PERSONAL DETAIL]" in out
    assert "Date of birth: [PERSONAL DETAIL]" in out
    assert "[EMAIL]" in out and "[URL]" in out and "[PHONE]" in out and "[ADDRESS]" in out
    assert "Call me on [PHONE] any time" in out
    assert not out.startswith("Blerim")


def test_replaces_contact_details_in_albanian_cv():
    out = scrub(ALBANIAN)
    for leaked in ["Arta", "Krasniqi", "044 123 456", "Durrësit", "01.02.2000", "+355", "69 123 4567"]:
        assert leaked.lower() not in out.lower(), leaked
    assert out.startswith("Curriculum Vitae")
    for label in ["Emri: [PERSONAL DETAIL]", "Tel: [PERSONAL DETAIL]", "Adresa: [PERSONAL DETAIL]",
                  "Datëlindja: [PERSONAL DETAIL]"]:
        assert label in out
    assert "JavaScript, React, Node.js, PostgreSQL" in out
    assert "(2021 – 2022)" in out and "Projekte: aplikacion për menaxhimin e detyrave, 2022" in out
    assert "[EMAIL]" in out and "[PHONE]" in out


def test_summary_first_line_is_kept():
    out = scrub(SUMMARY_FIRST)
    assert out.splitlines()[0] == "Motivated junior developer with three years of Python experience."
    assert "2020-2022" in out and "1 500 users" in out


@pytest.mark.parametrize("line, expected", [
    ("Contact +383 44 123 456", "Contact [PHONE]"),
    ("Contact 044 123 456", "Contact [PHONE]"),
    ("Mobile: (044) 123-456", "Mobile: [PERSONAL DETAIL]"),
    ("reach me at 00383 44 123 456", "reach me at [PHONE]"),
    ("Studied 2019-2023 and 2015 - 2019", "Studied 2019-2023 and 2015 - 2019"),
    ("Processed 10 000 000 records daily", "Processed 10 000 000 records daily"),
    ("Address: Street of Heroes 7, Prizren", "Address: [PERSONAL DETAIL]"),
    ("Lives at 221 Baker Street, London", "Lives at [ADDRESS], London"),
    ("Str. Ilir Konushevci 8", "[ADDRESS]"),
    ("Mail me: x.y [at] example [dot] org", "Mail me: [EMAIL]"),
    ("See github.com/someone/repo and www.example.com", "See [URL] and [URL]"),
    ("DOB: 1 May 2001", "DOB: [PERSONAL DETAIL]"),
])
def test_individual_patterns(line, expected):
    assert scrub("Summary of a motivated developer here\n" + line).splitlines()[-1] == expected


def test_bare_name_dropped_only_on_first_line():
    assert scrub("Blerim Hoxha\nPython and SQL developer with projects").splitlines() == ["Python and SQL developer with projects"]
    assert scrub("Software Engineer Intern\nPython").splitlines()[0] == "Software Engineer Intern"
    assert identity_names("Blerim Hoxha\nPython") == ["Blerim", "Hoxha"]


def test_prepare_keeps_realistic_cv_and_rejects_empty():
    assert len(prepare(ENGLISH)) > 200
    with pytest.raises(HTTPException):
        prepare("Blerim Hoxha\nblerim@mail.com")


def test_model_output_is_scrubbed():
    analysis = CvAnalysis(
        skills=["Python", "Contact blerim@mail.com"], program_ids=[], mentor_questions=["Ask Blerim about Docker"],
        title="Plan for Blerim Hoxha", goal="Call +383 44 123 456 and grow SQL skills",
        starter_tasks=[{"title": "Hoxha's first task", "criteria": "Push to github.com/blerimh", "day": 1}])
    data = sanitize_analysis(analysis, identity_names(ENGLISH))
    text = str(data)
    for leaked in ["Blerim", "Hoxha", "blerim@mail.com", "+383", "github.com/blerimh"]:
        assert leaked not in text, leaked
    assert data["skills"][0] == "Python"
    assert data["title"] == "Plan for [NAME] [NAME]"
    assert data["starter_tasks"][0]["day"] == 1
