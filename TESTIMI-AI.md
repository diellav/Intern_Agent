# Testimi i moduleve AI në InternAgent

Hape PowerShell nga projekti dhe zbato migrimet nëse po punon me një databazë tjetër zhvillimi.

```powershell
Set-Location 'C:\Users\Edona-Anchorz\Intern_Agent'
& .\.venv\Scripts\python.exe -m pip install -r apps/api/requirements-dev.txt
& .\migrate.ps1
```

Nise API-në dhe frontend-in në dy terminale të projektit. Nëse i ke nisur tashmë, rindize API-në dhe rifresko faqen. Backend-i lexon GROQ_API_KEY dhe GROQ_MODEL nga apps/api/.env.

```powershell
Set-Location 'C:\Users\Edona-Anchorz\Intern_Agent\apps\api'
& ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```powershell
Set-Location 'C:\Users\Edona-Anchorz\Intern_Agent'
npm.cmd --prefix apps/web run dev
```

Hape http://localhost:5173. Përdor llogari të ndara për intern, mentor dhe admin dhe të dhëna fiktive.

1. **Raporti.** Si mentor hap Progress reports, zgjidh një periudhë me të dhëna dhe kliko Generate summary. Kontrollo që çdo burim hap detyrën ose versionin. Redakto përmbledhjen, bëj Save draft, pastaj rifresko. Praktikanti nuk duhet ta shohë draftin. Pas Share with intern, praktikanti e gjen te Shared reports.
2. **Q&A.** Si praktikant hap një detyrë dhe kliko Ask about this task. Për provën e AI-së, si mentor krijo paraprakisht një shënim Shared të asaj praktike me fjalët e titullit të pyetjes dhe një përgjigje konkrete. Kliko Suggest an answer, pastaj Open source. Redakto draftin dhe posto përgjigjen. Provo linkun edhe me mentorin e një praktike tjetër. Duhet të marrësh gabim qasjeje.
3. **Sinjalet.** Në një praktikë aktive lër dy detyra të hapura me afat të kaluar. Overview duhet t'i tregojë te Needs attention. Provo Suggest next step dhe hap një detyrë nga evidenca. Përfundo njërën dhe rifresko. Sinjali i dy afateve duhet të largohet.
4. **CV.** Krijo një DOCX fiktiv me emër, një email fiktiv, dhe një paragraf për një projekt React, CSS ose QA. Si praktikant hap Plans → Learning profile. Kontrollo që Upload CV aktivizohet pasi zgjedh dokumentin dhe jep pëlqimin. Kliko Analyze CV. Si mentori i caktuar hap të njëjtën praktikë dhe kliko Open in plan editor. Kontrollo titullin, qëllimin, detyrat dhe afatet. Si praktikant zgjidh Withdraw consent and delete dhe verifiko që analiza zhduket për të dy llogaritë pas rifreskimit.
5. **Regjistri dhe votat.** Jep 👍 dhe pastaj 👎 te një sugjerim. Si admin hap Management → AI usage dhe kontrollo që shfaqet vetëm vota e fundit, modeli, kohëzgjatja dhe tokenët kur Groq i kthen. Për kufirin, në një workspace testues vendos përkohësisht AI_REQUESTS_PER_HOUR=1 dhe rindize API-në. Provo dy kërkesa me një përdorues pa përdorim në orën e fundit. E dyta duhet të tregojë kohën për riprovim. Ktheje konfigurimin në vlerën fillestare.

## Testet automatike

```powershell
Set-Location 'C:\Users\Edona-Anchorz\Intern_Agent\apps\api'
& ..\..\.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider tests
$env:INTERNAGENT_DB_TEST = '1'
& ..\..\.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider tests
Remove-Item Env:INTERNAGENT_DB_TEST
Set-Location ..\..
npm.cmd --prefix apps/web run build
```

Testet PostgreSQL përdorin MIGRATION_DATABASE_URL dhe bëjnë rollback të të dhënave testuese. Për ta provuar modelin real të Groq, ndiq hapat në browser me tekst fiktiv.
