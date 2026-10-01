# Architecture Review — Current Technology

Verdict: **PASS after fixes**.

Verified 2026-08-22 against official docs/package registries:

- Svelte 5.56.10
- SvelteKit 2.70.3
- Tailwind CSS 4.3.3
- @xyflow/svelte 1.6.3 (Svelte 5 compatible)
- Zod 4.4.3
- @sveltejs/adapter-node 5.5.7
- uv 0.11.16
- Bun 1.3.14 is the installed intentional pin (1.4.0 exists upstream)
- Official `sv create`, adapter-node, Tailwind/SvelteKit, and Svelte Flow docs exist.
- Splitter OpenAPI v0.2.0 has health/job/result/asset routes and no extend route.

Resolved review concerns:

- adapter-node is pinned.
- Zod 4-only convention is explicit.
- UX typo corrected from “SvelteKit 5” to SvelteKit 2.70.3 + Svelte 5.
- Private super-seed2 baseline has a vendored `METHODOLOGY-CONTRACT.md` for offline CI while credentialed agents still verify the live repo.
- Splitter adapter scope is limited to health and jobs routes.
