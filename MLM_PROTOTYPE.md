# MLM listener frontend prototype

This local fork starts at Music Assistant frontend tag `2.17.297.post1` (matching
Music Assistant server 2.10.7), on branch `codex/mlm-search-add`. It has not been
published to a GitHub fork. Keep upstream licensing and notices intact.

The user explicitly chose a Request button and acquisition status on October 25,
2026. An earlier Add to library choice was an accidental click and was withdrawn.
Never submit a download from Add to library, favorites, search or playback.

`/mlm-requests` adds catalog search and a paged request list inside the existing
player layout. The sidebar entry appears when an MLM provider is available.
It calls authenticated, instance-scoped commands supplied by the provider in
`../prototype/providers/mlm`. Credentials remain in that provider, never the browser.
The configured MLM username is displayed. This prototype uses one configured MLM
account; Music Assistant library-write scope and provider filters guard submissions.
Do not claim per-user automatic MLM account linking.

MLM development owns every identity, approval, request and completion decision.
Preserve selected catalog fields; never rematch a returned recording in JavaScript.
Only the URI returned from MLM's confirmed library mapping can be played. A cancelled
request needs an explicit Request again; refreshes must never revive it.

Build with `pnpm install --frozen-lockfile` and `pnpm run build`.
The adjacent prototype Compose file mounts `music_assistant_frontend` into the
upstream server. Restart the prototype after changes. Targeted checks:

```
pnpm test:run tests/components/MLMRequests.test.ts tests/components/navigation/getMenuItems.test.ts tests/components/AppSidebarHomeAssistant.test.ts
```

Phone URL: http://10.0.0.14:18095/#/mlm-requests. End-to-end acquisition acceptance
requires an explicit real Request click by the user; automated smoke checks only
read data. External playlist import/review is a separate remaining slice.
