# mz-ph-ui

Public static shell for the Operations Hub and reviewed public distribution artifacts.

Security boundary:
- no private application source;
- no service-role/provider secrets;
- Pages deploys an explicit `_site` allowlist only;
- update APKs are Release assets, never Git-tracked files;
- administrator bearer tokens are memory-only.

All rights reserved.
## Singapore cutover

Operations Hub runtime moved from the retired Ohio endpoint `https://ibshmenzooxndneqwqht.supabase.co` to the Singapore endpoint `https://ftcyyvyoowkctbupzkct.supabase.co` on 2026-09-26. The Ohio URL is retained here only as migration history; runtime code and CSP must use Singapore.



## Repository ownership boundary

This repository is **not** the canonical source for project-specific operations code or project facts.

- project-specific operational UI/source belongs in each project's private repository;
- project status producers, release policy, timelines, and backend logic belong in each project's private repository;
- this repository may carry reviewed public mirrors/generated artifacts only;
- `PUBLIC_ARTIFACT_PROVENANCE.json` records the canonical source for every project-owned public artifact currently mirrored here.

Current examples:
- Water-Ink Academy Web source → `xiaoshutong-ai/xiaoshutong-shuyuan/ops/public-web/`
- FuziPartner update policy → `xiaoshutong-ai/xiaoshutong-fuzipartner/ops/public-distribution/`
