# InternAgent si "hub" për internët: plani dhe promptat

**Qëllimi (nga biseda me HR-in):** HR-i dhe mentorët të dinë në çdo moment çka po bëjnë internët, pa pyetur
askënd. InternAgent nuk e zëvendëson Jira-n, GitHub-in apo Slack-un: i lexon ato, i lidh me internin dhe
i përkthen në një pamje të qartë.

**Parimet që vlejnë për të gjitha fazat:**
- AI përdoret vetëm nga mentori, admini dhe HR-i, për të analizuar punën. Interni nuk merr përgjigje ose punë të gjeneruar nga AI.
- Asgjë nuk dërgohet ose caktohet automatikisht pa klikimin e mentorit (rishikime, komente në PR, caktime në Jira).
- Internët janë njoftuar dhe pajtohen që aktiviteti i tyre në Jira dhe GitHub shfaqet këtu. Mesazhet e Slack-ut nuk lexohen.
- Çelësat (Jira, GitHub, Slack, Groq) qëndrojnë vetëm në `apps/api/.env`, server-side, jashtë logjeve.

**Çka kemi tashmë dhe e ripërdorim:**
- Jira sync, events dhe brief (`app/jira/`);
- caktimi në Jira me lidhjen e llogarisë sipas email-it;
- review assist me leximin e PDF/DOCX/linkeve (`review_sources.py`);
- attention guidance dhe progress reports;
- `slack_worker.py`;
- avatarët nga Jira.

## Rendi

| Faza | Çka sjell | Pse në këtë vend |
|---|---|---|
| 1. Pastrimi dhe roli HR | Heqja e CV-së, AI vetëm për stafin, roli `hr` | Baza e pastër për gjithçka tjetër |
| 2. Jira: caktimi me dropdown dhe vendosja pa CV | Tiketat e projektit, "Assign to" me dropdown, sugjerimet e AI-së | E kemi gati 80%, vlerë e menjëhershme |
| 3. GitHub | PR → dorëzim → analizë me AI → rishikim në PR | Vlera më e madhe për internët zhvillues |
| 4. Pamja e HR-it | Statusi, timeline, përmbledhja javore, rishikimet që presin | Dhimbja kryesore e HR-it |
| 5. Dokumentet dhe "Krijo në Jira" | Rishikim i gatshëm për t'u dërguar, detyra të reja direkt në Jira | Për internët jashtë IT-së |
| 6. Slack | Njoftime dhe përmbledhja javore në kanal | Kur pjesa tjetër punon |
| 7. Raporti përfundimtar | Raporti i praktikës me një klik | Kërkesë e universiteteve |

Çdo fazë është një prompt më vete. Jepi njërin pas tjetrit dhe testo në app para fazës tjetër.

---

## Faza 1: Pastrimi dhe roli HR

```
Faza 1 e planit në docs/PLAN-intern-hub.md: pastrimi dhe roli HR.

1. Hiq analizën e CV-së krejtësisht:
   - backend: app/cv.py, router-i në main.py, testet përkatëse;
   - frontend: features/ai/CvPanel.tsx dhe çdo përdorim i tij (Plans.tsx etj.), stilet që mbeten pa përdorim.
   - Tabelat dhe skedarët e CV-ve në storage: më trego sa rreshta dhe sa skedarë ka, dhe fshiji me një migrim
     Alembic të ri vetëm pasi të ta konfirmoj. Mos i prek migrimet e vjetra.
2. AI vetëm për stafin: kontrollo çdo endpoint që thërret Groq (review assist, attention, progress, plans generate,
   jira brief, ai_control) dhe sigurohu që interni merr 403. Ku UI i shfaq butona AI internit, hiqi. Shto teste.
3. Shto rolin `hr` me migrim Alembic:
   - memberships.role pranon 'hr';
   - HR-i sheh të gjithë internët, programet, projektet, detyrat, dorëzimet, rishikimet dhe Jira-n e workspace-it
     (vetëm lexim, me RLS);
   - HR-i nuk mund të rishikojë, publikojë plane, caktojë në Jira apo ndryshojë anëtarë;
   - HR-i mund të përdorë attention dhe progress reports;
   - Members lejon adminin ta ftojë ose ta ndryshojë dikë në 'hr'.
   - Në frontend, navigimi për HR: Overview, Internships (vetëm lexim), Projects, Reports.
4. Ruaji të dhënat ekzistuese dhe ndryshimet që gjen në repo.
   Dry-run çdo migrim (upgrade/downgrade/upgrade në transaksion të kthyer mbrapsht), pastaj apliko me migrate.ps1.
5. Në fund: testet e API-së, tsc dhe build. Më jep një përmbledhje të shkurtër dhe commit message, mos bëj commit.
```

## Faza 2: Jira, caktimi me dropdown dhe vendosja në projekt pa CV

```
Faza 2 e planit në docs/PLAN-intern-hub.md: caktimi i tiketave të Jira-s me dropdown dhe sugjerime nga AI.

Synimi: mentori ose admini sheh tiketat e projektit dhe i cakton te internët ose me dropdown, ose duke pranuar
sugjerimin e AI-së. Pa CV.

1. Te Projects → projekti → paneli i Jira-s, shto listën "Tiketat e hapura":
   - çelësi, titulli, tipi, statusi, epic-u dhe kush e ka;
   - filtër: të pacaktuara, të gjitha, sipas epic-ut;
   - anash secilës, dropdown "Assign to" me internët aktivë të atij projekti (avatar + emër) dhe "Unassigned".
   - Ndryshimi në dropdown e cakton tiketën në Jira (PUT /issue/{key}/assignee) pas një konfirmimi të shkurtër.
     Përdor llogarinë e lidhur të internit; nëse s'është e lidhur, ofro lidhjen sipas email-it në vend.
   - Pas caktimit, përditëso sync-un që lista dhe historia të jenë të sakta.
2. Sugjerimet e AI-së për vendosjen, pa CV:
   - për secilin intern të projektit, AI e sheh programin/departamentin, javën e praktikës, detyrat që ka kryer
     dhe kriteret e tyre, tiketat që ka tani, dhe tiketat e lira të projektit me brief-in;
   - kthen: në cilin modul/epic të projektit përshtatet tani (1 fjali pse) dhe 3–5 tiketa të lira të sugjeruara
     me arsyen dhe radhën;
   - në UI: te tab-i Jira i internit dhe si "Sugjerim: Era" pranë tiketës në listën e projektit;
     "Assign" me një klik, ose mentori zgjedh tjetër nga dropdown.
   - Mos sugjero tiketa të caktuara ose të mbyllura; çelësat e panjohur hidhen (si te plans/validate.py).
3. Kontrollet: vetëm admini dhe mentori i atij interni mund të caktojnë; HR-i e sheh listën pa dropdown.
4. Teste për caktimin (me Jira të simuluar, kurrë Jira live në teste) dhe për validimin e sugjerimeve.
5. Testi live vetëm në projektin PeopleHub me material fiktiv. Në fund: testet, tsc, build, përmbledhje dhe
   commit message, pa bërë commit.
```

## Faza 3: GitHub, PR-ja bëhet dorëzim

```
Faza 3 e planit në docs/PLAN-intern-hub.md: integrimi me GitHub.

Para kodit, më trego çka duhet të vendos në apps/api/.env (p.sh. GITHUB_TOKEN me qasje leximi në repo, ose
GitHub App) dhe çfarë lejesh. Mos ma kërko token-in në chat, as mos e lexo apo shfaq vlerën.

1. Konfigurimi:
   - te projekti, admini shton një ose më shumë repo GitHub (owner/name);
   - te interni, lidhet username-i i GitHub-it (si Jira account), me migrim Alembic.
2. Sync, me polling çdo 15 minuta si Jira, sepse app-i s'ka ende adresë publike për webhooks:
   - lexo PR-të e internëve të lidhur në repot e projektit (open, merged, closed), commit-et, review-t dhe
     komentet;
   - ruaj vetëm meta-të dhe tekstin që duhet; diff-in lexoje kur analizohet, me limit madhësie.
3. PR → dorëzim:
   - lidh PR-në me detyrën sipas Jira key-t në titull, branch ose përshkrim (p.sh. FLEET-12). Nëse s'ka key,
     shfaqe te mentori si "PR pa detyrë" që ta lidhë me dorë.
   - krijo automatikisht një version dorëzimi te detyra me link te PR-ja, përshkrimin dhe listën e skedarëve.
     Push-et e reja në të njëjtën PR bëjnë version të ri vetëm kur interni kërkon rishikim prapë (re-request
     review) ose kur kalon një kohë e caktuar, jo në çdo commit.
   - kur PR-ja bashkohet, detyra shënohet e kryer (me njoftim te mentori).
4. Analiza me AI për mentorin, duke zgjeruar review assist:
   - a i plotëson ndryshimet kriteret e detyrës, me evidencë nga diff-i;
   - cilësia e përshkrimit të PR-së: çka bën, si testohet, çka mungon;
   - probleme konkrete në kod me skedarin dhe rreshtin, pa nitpicks;
   - feedback-u i mëparshëm: a është adresuar;
   - një draft rishikimi me pika të numëruara.
5. Mentori: "Send to GitHub" e poston draftin si review comment në PR (vetëm nëse token-i ka leje shkrimi;
   përndryshe "Copy"), ose e ndryshon para se ta dërgojë, ose e shkruan vetë. Asgjë automatike.
6. Teste me GitHub të simuluar. Testi live vetëm në një repo testi me PR fiktive.
7. Në fund: testet, tsc, build, përmbledhje dhe commit message, pa bërë commit.
```

## Faza 4: Pamja e HR-it

```
Faza 4 e planit në docs/PLAN-intern-hub.md: pamja për HR-in dhe adminin.

Dhimbja: HR-i nuk e di çka po bëjnë internët. Pamja duhet të përgjigjet në 10 sekonda, pa terma teknikë.

1. Faqja "Interns overview" (HR dhe admin; mentori sheh vetëm internët e vet):
   - një rresht për intern: avatari, emri, departamenti/programi, projekti, mentori, java e praktikës;
   - statusi: On track, Slow, Blocked ose Waiting on mentor, me arsyen në një fjali, i llogaritur nga të dhënat
     (lëvizjet në Jira, PR-të, dorëzimet, afatet, rishikimet që presin), jo nga AI;
   - "Last activity" (p.sh. "PR #42 merged, 2 days ago");
   - filtra sipas departamentit, projektit dhe statusit.
2. Timeline për çdo intern: lëvizjet në Jira, PR-të (open/review/merged), dorëzimet, rishikimet dhe komentet e
   mentorit, të gjitha bashkë sipas kohës.
3. Përmbledhja javore me AI për HR-in: një paragraf i shkurtër për secilin intern në gjuhë jo-teknike
   (çka kreu, çka po bën, ku ka ngecur, a i duhet ndihmë), plus 3 pika për tërë grupin.
   Ruaje që të mos rigjenerohet në çdo hapje.
4. Mentorët: rishikimet që presin më shumë se 2 ditë pune, sipas mentorit. Pa ton fajësues.
5. Ripërdor attention dhe progress ku ka kuptim; mos i dyfisho.
6. Teste për llogaritjen e statusit dhe për qasjen (HR sheh të gjithë, mentori vetëm të vetët, interni asgjë).
   Në fund: testet, tsc, build, përmbledhje dhe commit message, pa bërë commit.
```

## Faza 5: Dokumentet dhe "Krijo në Jira"

```
Faza 5 e planit në docs/PLAN-intern-hub.md.

A. Rishikimi i dokumenteve, për internët jashtë IT-së:
   - review_sources.py tashmë lexon PDF/DOCX/linke. Kontrollo që teksti i dokumentit i shkon AI-së i plotë
     (me limit), jo vetëm përshkrimi.
   - AI krahason dokumentin me kriteret dhe me feedback-un e mëparshëm, dhe jep draftin e rishikimit.
   - Mentori ka "Use this review", që e vendos draftin në formën e rishikimit për ta ndryshuar dhe dërguar,
     ose e shkruan vetë. Asnjë dërgim automatik.
B. "Krijo në Jira":
   - kur mentori krijon detyrë për një intern në një projekt me Jira, ofro "Also create in Jira" (tipi, epic-u,
     përshkrimi me kriteret), caktoje te interni dhe lidhe me jira_key.
   - Sync-u pastaj e njeh si tiketë normale.
Teste me Jira të simuluar. Në fund: testet, tsc, build, përmbledhje dhe commit message, pa bërë commit.
```

## Faza 6: Slack

```
Faza 6 e planit në docs/PLAN-intern-hub.md: njoftime në Slack.

Shiko çka bën tani app/slack_worker.py dhe ndërto mbi të.
1. Njoftime, vetëm dërgim dhe kurrë lexim i mesazheve:
   - mentori: dorëzim ose PR i ri për rishikim, intern i bllokuar;
   - interni: rishikim i ri ose kërkesë për ndryshime, tiketë e re e caktuar;
   - HR: përmbledhja javore në një kanal që e zgjedh admini.
2. Lidhja e personave me Slack sipas email-it (users.lookupByEmail), pa lidhje manuale.
3. Çdo person mund t'i fikë njoftimet e veta. Token-i vetëm në .env.
4. Më trego cilat scopes duhen për Slack App dhe çka duhet të aprovojë admini i Slack-ut.
Teste me Slack të simuluar. Në fund: testet, përmbledhje dhe commit message, pa bërë commit.
```

## Faza 7: Raporti përfundimtar i praktikës

```
Faza 7 e planit në docs/PLAN-intern-hub.md: raporti përfundimtar.

Te interni, "Final report" (HR, admin, mentori):
- të dhënat: periudha, departamenti, projekti, mentori, detyrat dhe tiketat e kryera, PR-të e bashkuara,
  dorëzimet dhe rishikimet, progresi sipas javëve;
- AI shkruan vlerësimin në gjuhë formale: çka bëri, aftësitë e treguara me shembuj nga puna, ku u përmirësua,
  rekomandimi. Vetëm nga të dhënat reale, pa shpikur;
- mentori e redakton dhe e aprovon; pastaj eksport në PDF/DOCX.
Teste për ndërtimin e të dhënave. Në fund: testet, tsc, build, përmbledhje dhe commit message, pa bërë commit.
```

---

## Pyetje që duhen sqaruar gjatë rrugës
- **GitHub (para fazës 3):**
  - Cilat repo i përkasin cilit projekt?
  - Kush e jep token-in ose e instalon GitHub App-in?
  - A lejohet komentimi në PR nga app-i?
- **Slack (para fazës 6):** Kush e aprovon Slack App-in? Cili kanal përdoret për përmbledhjen e HR-it?
- **Raporti (para fazës 7):** Çfarë formati kërkojnë universitetet? Një shembull i vjetër do ndihmonte.
