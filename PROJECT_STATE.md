# PROJECT_STATE.md — Provider Hub / public shell continuity index

> Continuity snapshot only. Revalidate live GitHub/CI/Pages/provenance evidence before acting.

snapshot_date: 2026-10-06
integration_branch: main
observed_head: 818b0722b9dce951fb7c058b8efa17a217d04427
active_writer: none observed in open PRs during this audit
open_prs: none observed during this audit

## Current role

- Public static shell for Operations Hub/distribution artifacts.
- Project-specific source, status producers and backend logic remain canonical in each private project repository.
- Recent work tightened provenance-owner selection; no current Pages/E2E PASS is inferred here.

## Authority pointers

- `AGENTS.md`
- `README.md`
- `PUBLIC_ARTIFACT_PROVENANCE.json`
- canonical private source repository for the affected project

## Next executable action

Live-fetch current main/PR/CI/Pages state, identify the canonical owner of the public artifact, and only then modify or republish the mirror.