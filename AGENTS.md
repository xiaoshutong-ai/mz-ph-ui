# AGENTS.md — mz-ph-ui agent rules

## Repository boundary

This is a public static shell for the Mengzheng account/Operations Hub and public distribution metadata.

Security invariants:
- no private application source;
- no service-role/provider secrets;
- no committed API keys, bearer tokens, signing material, or private credentials;
- Pages deploys only the explicit public allowlist;
- APK binaries belong in Release assets, not Git-tracked source;
- administrator bearer tokens remain memory-only.

These constraints outrank convenience.

## Continuous goal execution

For an explicitly authorized objective, continue:
inspect -> implement -> verify -> commit/push working branch -> CI/Pages validation -> inspect failure -> fix -> rerun -> acceptance.

A partial step or failed build/CI/deploy validation is not completion. Do not ask the owner to type "continue" after each reversible iteration.

Focused reversible edits, commits, pushes to the authorized working branch, existing CI runs, and failure-driven fixes may proceed without repeated approval.

## Stop conditions

Request owner input before destructive Git-history operations, credential/permission changes, authentication trust-boundary changes, public deployment not already included in the objective, or changes to the public/private data boundary.

Do not print or persist administrator bearer tokens in logs, artifacts, screenshots, or committed files.

## Verification

Use existing GitHub Actions/Pages workflows as the formal repository gate when present. Inspect actual workflow/job evidence before modifying CI.

Distinguish SOURCE_REVIEW, BUILD_PASS, CI_PASS, PAGES_DEPLOY_PASS, and END_TO_END_PASS. Do not claim a layer that was not actually run.

The objective is complete only when its mandatory acceptance criteria pass or an owner-approved limitation is recorded.


## Execution ownership

- The Project Owner is the final authority for product direction, priorities, risk acceptance, and high-impact decisions.
- GPT is the primary engineering executor and orchestrator for authorized work: inspect repository state, edit code/docs/tests, create focused commits, push working branches, run or inspect GitHub Actions/self-hosted CI, diagnose failures, and iterate to acceptance.
- GitHub is the durable source of engineering truth. Existing GitHub Actions/self-hosted runners are the default execution and formal verification path for repeatable engineering work.
- Use the owner's authorized local machine, Remote Desktop/terminal, Android Emulator, adb, or real device when CI cannot faithfully perform the required OS/GUI/hardware/device/debugging work.
- Do not plan around Codex, require Codex participation, or consume Codex quota as part of the normal workflow.
- Minimize owner intervention. Ask the owner only for decisions or actions that genuinely require owner authority, unavailable credentials/2FA, or irreversible/high-impact approval.

## Fresh-session Project Agent continuity

- Project GPT is the default technical executor for this public shell.
- Recovery order: `AGENTS.md` -> `README.md` -> provenance/public-artifact metadata -> live GitHub branch/PR/head/CI/Pages evidence.
- Project-specific source and product facts remain owned by their canonical private repositories; do not turn this mirror into a competing authority.
- Check for an existing writer/PR before changing a public mirror.
- This public mirror intentionally does not add a separate `PROJECT_STATE.md`; current-state recovery comes from existing public metadata/provenance plus live GitHub/CI/Pages evidence. A documentation snapshot never proves Pages deployment or end-to-end behavior.
