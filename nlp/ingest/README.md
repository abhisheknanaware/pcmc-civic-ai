# PCMC knowledge ingestion

Builds the chatbot's knowledge base from **public** PCMC pages and documents.

```
python -m ingest.crawler      # polite crawl -> data/crawl/raw + index.json (resumable, change detection)
python -m ingest.extract      # raw -> documents.jsonl (add --ocr once Tesseract is installed)
python -m ingest.report       # inventory.md / inventory.csv for human review
```

## Crawl rules (`sources.json`)
- Allowed domain: `www.pcmcindia.gov.in` only. `robots.txt` is checked for every host.
- One request every 2 s, PDFs capped at 20 MB, depth 2 from the seeds + sitemap.
- Only URL patterns listed under `rules` are fetched. `exclude` drops elections, budgets, audits, tenders,
  news, photos, jobs, RTI manual PDFs and anything that is not citizen-service information.
- No logins, no private endpoints. The only POSTs are the site's public English/Marathi toggle.
- Circulars: the public archive is listed per month; only titles matching citizen-service keywords are
  downloaded (HR orders such as retirements/transfers are skipped). Title, reference number and date come
  from the official listing, not from guessing.
- Links to other sites are recorded in `external_links.json` and never followed automatically.

## Document fields (`documents.jsonl`)
| field | meaning |
|---|---|
| `url`, `session_lang` | source page and which language toggle it was fetched with |
| `category`, `doc_type`, `department` | citizen_charter / circular / department_info / info_page / policy ... |
| `authority_level` | 1 = official current PCMC source, 2 = official supporting (e.g. RTI disclosures) |
| `published_date`, `ref_no`, `doc_kind` | from the circular archive listing when available |
| `effective_from`, `effective_until`, `supersedes`, `superseded_by` | filled only from explicit text or officer review - never guessed |
| `status` | active (still listed on the live site) / historical (removed or superseded) / disabled (officer) |
| `verified` | officer-approved; unverified content is used at lower confidence |
| `extraction_method`, `text_quality`, `ocr_confidence`, `needs_ocr` | html / pdf_text / ocr and a quality verdict (scanned, legacy_font, broken_unicode) |
| `sha256`, `changed`, `first_seen`, `fetched_at` | raw-file hash for change detection and freshness |
| `content_hash`, `duplicate_of` | normalised-text hash, e.g. English page identical to the Marathi one |
| `language` | mr / hi / en / mixed, detected from the text |
