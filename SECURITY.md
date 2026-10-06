# Security

This repository contains only a public static operational frontend.

It must never contain:

- provider API keys or passwords;
- Supabase secret/service-role keys;
- database credentials;
- private application source code;
- private user data.

The public root is a neutral project page and does not load the operational console script. That reduces casual discoverability only; it is not a security boundary. Authentication and authorization are enforced server-side. Saved provider keys are stored only in the backend Vault and are never returned to this frontend.

Copyright © 2026. All rights reserved. No license is granted for reuse, modification, or redistribution.


## Public distribution boundary

GitHub Pages is built from an explicit allowlist into `_site`. The repository root must never be deployed directly.

Public update metadata may live only under `updates/`. APK binaries must never be committed to Git or Pages; they belong only in GitHub Release assets.

The Operations Hub administrator bearer token is memory-only. It must not be persisted in `localStorage`, `sessionStorage`, IndexedDB, cookies, or static files. Reloading the page intentionally requires a new authenticated session/MFA flow.

The Supabase project URL and `sb_publishable_*` browser key are public client configuration, not secrets. Service-role keys, provider API keys, private keys, runtime consumer raw tokens, user data, and private application source must never enter this repository.


## Server-side source boundary

The deployed Operations Hub Edge Function source is canonical in the private `xiaoshutong-ai/xiaoshutong-Mengzheng` repository. Server-side Supabase function source is forbidden in this public repository.

This repository may expose only browser-delivered static client code and explicitly approved public update metadata. Server-side authorization, Vault/RPC implementation, private migrations, service-role logic, and private application code must remain private.


## Project-artifact provenance boundary

Project-specific public files in this repository are distribution mirrors or generated artifacts, never the project source of truth. Their canonical private sources are declared in `PUBLIC_ARTIFACT_PROVENANCE.json`.

A project-specific operational fact, release policy, project UI implementation, timeline, status producer, or backend implementation must be authored in the owning private project repository first. The public shell may only publish the reviewed public projection needed by browsers or update clients.
