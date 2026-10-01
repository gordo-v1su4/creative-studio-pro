# Architecture Review — Adversarial Seams

Verdict: **PASS after fixes**.

Independent Kimi K3 review constructed compliant-but-incompatible unit pairs. The spine now closes each seam:

1. SceneSegment/Storyboard persisted shapes live in domain; Splitter only maps.
2. A dispatched job remains authorized after quote expiry; expiry gates only new dispatch.
3. One media ingest port computes canonical hashes; capability adapters never persist.
4. Creative Room uses one job per voice and a stable run/model idempotency key.
5. Canvas layout is a separate last-writer-wins document through the gateway; canonical records still use expected versions.
6. One project-store read-model builder serves UI and operations.
7. Health checks use non-billable endpoints only.
8. Persisted paths are project-relative or bucket/object keys; absolute roots are runtime config only.

No unresolved seam blocks epics/stories.
