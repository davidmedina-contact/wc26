# Testing and Deployment Rules

## Pre-Deployment Checklist

Before deploying ANY change to production:

1. **Sync with remote** — Always `git fetch` and verify your local branch matches what's actually in production. The deployed code may have diverged from your local state (other sessions, manual edits, Vercel auto-deploys from GitHub).

2. **Run the test suite** — `npm run check` must pass with zero failures before committing. This runs syntax checks on all JS files AND the unit tests.

3. **Test against production data** — Verify the `/api/data` endpoint returns expected data (correct number of scores, standings, etc.) by curling the production URL after deploy.

4. **Test the full render path** — Use Chrome DevTools (or the Chrome MCP) to verify the page actually renders correctly after deploy. Check that:
   - Group tables show correct standings with real numbers
   - FT scores appear on finished matches
   - Team modals open with full squad data
   - No console errors

## Testing with Chrome DevTools MCP

When testing locally vs production:

- **Local testing** (python http server) does NOT have the `/api/data` serverless function. The app falls back to `data.json`. This is expected — don't treat the 404 on `/api/data` as a bug locally.
- **Production testing** — Clear SW, caches, AND localStorage to simulate true cold load. Use `navigator.serviceWorker.getRegistrations()` + `caches.keys()` + `localStorage.clear()`.
- **Network throttling** — Use "Slow 3G" to catch timing issues that don't appear on fast connections. The static shell and inline data should render instantly regardless of throttling.

## Critical Data Integrity Rules

- **Never deploy with fewer scores than production currently has.** The `actualScores` object should only grow. If your local data.json has fewer entries than what the API serves, your deploy will regress the user experience.
- **The `/api/data` serverless function is the source of truth for dynamic data.** The static `data.json` is a fallback. Don't assume your local copy is current.
- **Always verify origin/main before modifying** — Run `git fetch origin` and compare. If origin/main has diverged, reset to it first (`git reset --hard origin/main`), then apply your changes on top.

## Service Worker & PWA Update Lifecycle

### How updates work (the full chain)

1. **Detection**: The browser byte-compares the deployed `service-worker.js` against the installed copy. If even one byte differs, it considers the SW "updated." This check happens on: (a) navigation to an in-scope page, (b) `reg.update()` called programmatically, (c) push/sync events if >24h since last check.

2. **Install**: The new SW enters the `installing` state. Our `install` handler precaches core shell assets into a new cache bucket.

3. **Waiting → Activation**: By default, the new SW waits until all tabs using the old SW are closed. We bypass this with `self.skipWaiting()` in the install handler, which immediately promotes to `active`.

4. **Claim**: `self.clients.claim()` in the activate handler makes the new SW take control of existing pages without waiting for a navigation.

5. **Client notification**: The page listens for `controllerchange` and/or the `updatefound` → `statechange` → `'activated'` sequence. Either triggers `window.location.reload()` to serve fresh assets from the new SW's cache.

6. **User sees fresh content**: After reload, the new SW serves the updated `index.html` (fetched during its install phase), which includes the new `app.js`, `style.css`, etc.

### Why updates fail (common pitfalls)

- **SW file doesn't change between deploys** → browser never detects an update. FIX: `scripts/stamp-sw.js` writes a `BUILD_TS` timestamp on every deploy via `npm run deploy`.
- **SPA has no hard navigation** → the browser's automatic update check (which fires on navigation) never triggers. FIX: `reg.update()` on `visibilitychange` (when app returns from background).
- **iOS standalone mode freezes the page** → when the app is backgrounded, iOS may serve a frozen DOM snapshot on relaunch rather than performing a fresh load. FIX: the `updatefound` → `statechange` → `activated` listener fires a reload after 300ms even if `controllerchange` was swallowed.
- **`window.location.reload()` uses bfcache on iOS** → sometimes the reload doesn't hit the network. FIX: after controllerchange fires, the new SW is already active and its fetch handler serves network-first for `/` and `/index.html`, so even a bfcache-busted load gets fresh HTML.
- **Vercel CDN caches the SW file** → our `vercel.json` sets `Cache-Control: no-cache, no-store, must-revalidate` on `/service-worker.js` specifically to prevent this.

### iOS PWA-specific gotchas

- iOS Safari only performs SW update checks on navigation requests. In standalone mode (home screen PWA), the only "navigation" is launching the app. Once running, there are no navigations — `reg.update()` on `visibilitychange` is the only workaround.
- iOS may not fire `controllerchange` reliably in standalone mode. Belt-and-suspenders: listen for both `controllerchange` AND `reg.installing.statechange === 'activated'`.
- `localStorage` persists independently of SW/cache state. It's the most reliable fast-path for returning iOS users (instant render from cached dynamic data even if the SW is being replaced).
- The "Updated just now" toast has a 6s window specifically because iOS standalone has a 1-2s launch animation that eats into visible time.

### Lessons learned: Chrome fresh, iOS PWA stale

When Chrome shows updated scores but the iOS Home Screen PWA does not, do not assume the serverless function failed. There are three separate freshness layers:

1. **Vercel Function/CDN** — `/api/data` may already be fresh and cached at the edge.
2. **Service Worker Cache API** — the installed PWA can still have an older cached `/api/data` response.
3. **PWA `localStorage`** — the app may render old dynamic data before the network refresh completes.

The serverless function cannot push fresh data into an installed PWA. It can only return fresh data when the client asks. Vercel's `s-maxage` and `stale-while-revalidate` refresh the CDN cache, not every user's local Cache API or `localStorage`.

Rules from the June 2026 iOS stale-data incident:

- App startup must explicitly request `/api/data` with `cache: "reload"`, `Cache-Control: no-cache`, and `Pragma: no-cache`.
- The service worker must treat that no-cache request as network-first and update its cached `/api/data`.
- Background SWR messages are a nice-to-have, not the primary freshness path on iOS.
- Dynamic data must never move backward. If the PWA has seen 43 completed matches, a 40-match bundled snapshot or older cache must not overwrite it.
- A successful Chrome/Safari browser test does not prove the installed iOS PWA is fresh. Test an installed PWA path or simulate service-worker cache + `localStorage` behavior.
- Verify both sides of freshness: production `/api/data` payload (`finishedMatches`, stats, score count) and the UI after a cold/reopened PWA launch.

### Lessons learned: foreground pull beats background push

iOS and Android PWAs are reliable when they pull fresh data while foregrounded.
They are not reliable as silent background subscribers. Do not design this app
around closed-PWA background polling, Periodic Background Sync, or quiet Web Push.

Rules for dynamic tournament data:

- `/api/data` must emit a stable `meta.dataVersion` and matching `ETag` based on
  football data, not `updatedAt`.
- Include every UI-visible dynamic field in `meta.dataVersion`, especially
  `actualScores`, `standingsData`, `thirdPlaceData`, and `statsData`. A shell
  update can still render stale `localStorage` data if a new required field was
  omitted from the version hash and the server returns `304 Not Modified`.
- When adding a required dynamic field, add a client schema guard that discards
  old cached payloads before first render and forces a fresh `/api/data` merge.
- The service worker compares `meta.dataVersion` before posting `DATA_UPDATED`;
  full-body comparison creates false updates because `updatedAt` changes.
- The app should pull on startup, `focus`, and `visibilitychange`, with a
  cooldown from `meta.nextRefreshSeconds`.
- Only foreground/open PWAs can be refreshed immediately. Closed PWAs refresh on
  the next launch or focus.
- Vercel Hobby cron is not a fit for match-by-match refresh. Use adaptive CDN
  `s-maxage` plus foreground pulls.

### Deployment workflow (mandatory)

```bash
# ALWAYS use this instead of bare vercel deploy:
npm run deploy
```

This runs `stamp-sw` (stamps `BUILD_TS`) then `vercel --prod --yes`. The stamped SW file guarantees the browser detects a new version on the next `reg.update()` call.

- The SW cache name (e.g. `wc26-v19`) only needs manual bumping when you change caching *strategy* (precache list, SWR logic, network-first patterns). For normal code/UI deploys, the `BUILD_TS` stamp is sufficient.
- Update the test assertion when you bump the cache name.
- Never remove `self.skipWaiting()` — it's critical for single-tab environments (iOS PWA).

### Lessons learned: serverless-only does not mean PWA-invisible

If a serverless change alters visible app data or behavior, it is a PWA release.
Examples: FT scores, group standings order, stats, stale-data guards, cache
semantics, or any response shape the UI renders. Deploying those changes with
bare `vercel --prod` updates the function but leaves `service-worker.js`
byte-identical, so installed PWAs have no new version to detect and no update
confirmation to show.

Rules from the June 2026 standings-order incident:

- Before any production deploy, re-read this deployment section rather than
  deciding from memory whether a change is "backend-only."
- Use `npm run deploy` for every user-visible release. It stamps
  `service-worker.js` and deploys the matching source.
- Do not rely on "push to main" or raw `vercel --prod` for user-visible changes;
  those paths can skip the service-worker byte change that installed PWAs need.
- After `npm run deploy`, commit and push the stamped `service-worker.js` so Git
  and the live Vercel source stay at parity.
- Keep README, operations docs, and steering docs aligned on the same deploy
  command. If one says `vercel --prod`, it is stale unless it explicitly means a
  non-visible backend-only hotfix.

### Lessons learned: scorer strings are not event data

Free score feeds may expose scorer fields, but these are not reliable event
objects. They can have transliterated names, missing goals, own goals listed on
the benefiting team's side, and stoppage-time formats like `45'+5'`. Treat them
as untrusted labels that require validation.

Rules from the June 2026 scorer-card incident:

- The invariant is mandatory: for every finished match, displayed scorer labels
  must equal the final score total.
- Own goals count in match-card labels for the benefiting team but must not count
  toward top-scorer stats.
- Known verified corrections belong in `data/scorer-overrides.json` with source
  URLs, not as silent one-off code branches.
- Parser aliases are acceptable only for complete provider tokens that resolve
  to known squad players; they are not a substitute for missing event data.
- Fix recurring scorer-feed transliteration failures in the resolver, not as
  match-card display patches. The feed often substitutes `v` for vowels and
  mangles Latin names; keep these patterns centralized in scoring resolution so
  match cards and top-scorer stats stay consistent.
- Use explicit scorer aliases only when the provider token loses semantic
  information, such as an own goal without an `(OG)` marker.
- Scorer verification belongs in `/api/data`, not in the PWA. The function may
  use bounded server-side checks against free sources when scorer labels are
  incomplete or recently finished. API-Football must be explicitly enabled with
  `API_FOOTBALL_SCORERS=1` plus an API key; ESPN and TheSportsDB are fallback
  sources without app-client exposure.
- Accept external scorer events only when they match the final score total by
  side. If no source passes that invariant, keep the parser fallback and expose
  the attempt details in `meta.scorerResolution`.
- Keep verifier calls capped with `SCORER_VERIFIER_MAX_MATCHES` and cache the
  resulting `/api/data` response at Vercel's CDN. Vercel Functions do not
  provide durable local storage, so do not rely on process memory or local files
  as the source of truth.
- Before deploying scorer changes, run the full live-feed audit against all
  finished matches and confirm `/api/data` reports `meta.scorerCompleteness:
  "verified"` and `meta.scorerIssueCount: 0`.

### Lessons learned: clinch labels must be mathematical locks

FIFA World Cup 2026 group advancement is top two from each group plus the eight
best third-place teams. Group ordering uses points, head-to-head points,
head-to-head goal difference, head-to-head goals, overall goal difference,
overall goals, fair play, then FIFA rankings. The free feed does not include
fair-play deductions or ranking tie-break state, so the app must avoid
speculative status labels.

Rules for standings qualification badges:

- Compute `Group winner`, `Qualified`, and `Eliminated` in `/api/data`; the client
  should only render the status object it receives.
- Only show a badge when remaining group outcomes cannot change that status by
  points math. Open races get no badge.
- Enumerate remaining win/draw/loss outcomes for the group instead of comparing
  each team's maximum points independently; chasers often still play each other.
- Apply already-settled head-to-head edges inside those outcome scenarios. A
  team can lock first place through head-to-head wins even when another team can
  still match its points. Do not lock labels that depend on unknowable future
  goal-difference swings.
- Completed groups may use the serverless-sorted table for winner, runner-up,
  and fourth-place eliminated labels, but third-place advancement should remain
  conservative until the global third-place picture is settled or mathematically
  locked.
- Render compact `W`, `Q`, and `E` markers with a legend, following common
  sports standings patterns. Full-word row badges are too noisy on mobile.
- Add tests for both positive and negative cases: a clinched team, a won group,
  a completed group, and a team that looks strong but is not yet guaranteed.

Rules for bracket/live-results balance:

- Live locked seeds override local user picks. User picks are fallbacks for
  unresolved groups and later knockout guesses, not a replacement for real
  standings.
- Do not assign third-place teams to Round-of-32 slots by Elo or prediction
  strength. FIFA uses an Annex C combination matrix based on exactly which
  third-place groups qualify; show candidate-group placeholders until that
  combination is known.
- The Groups tab may show the current top-eight third-place teams' provisional
  Round-of-32 paths, but those paths must come from the local generated Annex C
  matrix in `data/third-place-combinations.json`. Do not scrape Wikipedia or
  compute a probability heuristic at request time. Tests should pin the current
  combination number and opponent slots.

## Static vs Dynamic Data Architecture

The app uses a split architecture:
- **Static data** (teams, squads, schedule, predictions): Embedded as `<script type="application/json" id="static-data">` in index.html. Renders instantly, zero network dependency.
- **Dynamic data** (actualScores, standingsData, statsData): Fetched async from `/api/data`, cached in localStorage (7KB), overlaid on the static render.

When modifying static data (squad changes, new predictions), you must regenerate the inline JSON in index.html. Use the `/tmp/embed-static.js` pattern or equivalent script to extract from `data.json` and inject into the HTML.

## Performance Budgets

- HTML + inline static data: ~39KB brotli (single request)
- Dynamic data fetch: ~7KB (background, non-blocking)
- First Contentful Paint target: <500ms on Fast 4G
- Time to Interactive: <500ms from SW cache
- CLS: 0.00 (no layout shift on data hydration)

## Execution and Iteration Rules

- **Two-strike rule for failed approaches** — If a tool call or approach fails twice (timeout, stall, error), stop retrying that exact path. Step back, diagnose the root cause, and choose a fundamentally different approach.
- **Visual UI assessment** — Do not rely on `mcp_chrome_devtools_mcp_take_screenshot` for UI critique work; it has stalled in this workspace. Instead use `mcp_chrome_devtools_mcp_take_snapshot` (a11y tree) combined with `mcp_chrome_devtools_mcp_evaluate_script` to inspect computed styles, element dimensions, and DOM structure. For visual design decisions, reason from the existing CSS and HTML directly rather than from a rendered screenshot.
- **Long-running MCP tool calls** — If a Chrome MCP call doesn't return within a reasonable time (>30s for non-trace operations), assume it's stalled and abandon that path.

## UI Design Standards

- **Research first** — Before implementing any UI change, research how leading sports apps (FotMob, Apple Sports, SofaScore, OneFootball) handle the same pattern. Prefer proven, space-efficient designs over novel ideas.
- **Make good use of space** — Every element should earn its pixels. Avoid full-width lines for secondary info when it can be folded into an existing row (subtitle, inline, or second line). Prefer compact, information-dense layouts.
- **Be compelling** — The UI should look polished and intentional. Use visual hierarchy (size, weight, color, spacing) to guide the eye. Muted secondary info, bold primary info.
