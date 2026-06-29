# Operations

## Architecture

`/api/data` is the only live-data boundary. It performs five jobs before returning a payload:

1. Race the upstream match feed against a read-only proxy fallback.
2. Read the provider's group table as optional standings numbers.
3. Accept only known teams, valid integer scores, and games explicitly marked finished.
4. Derive FT scores and stats from the same accepted records.
5. Reject incomplete data once a scheduled match is four hours past kickoff.

The provider table is accepted only when every row is internally consistent and its total matches played agrees with the accepted game records. The function still re-sorts accepted rows before returning them because the upstream order has been observed to put teams with more points below teams with fewer points. Sorting follows the calculable FIFA group ranking criteria: points, head-to-head points, head-to-head goal difference, head-to-head goals scored, overall goal difference, and overall goals scored. Fair-play and FIFA-ranking tie-break data are not in the feed, so the static group draw order and team name are deterministic final fallbacks. If the provider table is unavailable or lagging, the function computes the same sorted table from the games.

The function also annotates standings rows with qualification statuses when the outcome is mathematically locked. FIFA's 48-team format advances each group winner and runner-up, plus the eight best third-place teams. The function enumerates the remaining win/draw/loss point outcomes inside each four-team group so it accounts for chasers taking points from each other. Because this feed does not include fair-play deductions or live FIFA ranking tie-break data, status labels are intentionally conservative:

- `Group winner` appears only when a team is first in a complete group, no other group team can match its points total, or every matching-points scenario is already settled by head-to-head wins.
- `Qualified` appears only when a team is guaranteed to finish in the automatic top two, or when a third-place team is guaranteed to be among the eight best third-place teams by the available points math.
- `Eliminated` appears when a team is fourth in a complete group, cannot reach enough points to avoid bottom place, or a completed third-place finish is mathematically outside the eight best third-place slots.
- Open races intentionally show no badge. Already-settled head-to-head wins can lock a label; unknowable future goal-difference swings cannot. Do not add predictive, probability-based, or provider-provided clinch labels unless the data source includes the missing tie-break fields and tests prove the label cannot be wrong.

The Groups tab borrows the common sports-standings convention of compact status letters plus a legend. Rows show `W` for group winner, `Q` for qualified, and `E` for eliminated, with the full label exposed through the group legend and accessibility labels. Avoid full-word badges in the row; they crowd the mobile table.

The Bracket tab must prefer live locked seeds over user picks. A mathematically locked group winner can flow into its official Round-of-32 slot immediately; completed runner-up and qualified third-place seeds can flow once known. User picks remain useful for unresolved groups and knockout guesses, but they must not override live results. Third-place Round-of-32 slots should show FIFA candidate groups such as `3 C/E/F/H/I` until the exact Annex C combination is known; do not route third-place teams by Elo or prediction strength.

The third-place race table can show a provisional Round-of-32 path for the
current top-eight third-place groups. This is derived server-side from
`data/third-place-combinations.json`, a generated local copy of the 495
Annex C combinations published in the Wikipedia knockout-stage table and
sourced from FIFA's tournament regulations. Do not scrape this table at request
time. If the source matrix changes, regenerate the JSON, rerun tests, and verify
the current combination number and opponent slots.

Third-place rows are team rows. They must open the same team modal as normal
group standings rows. The Groups tab installs an early click listener before
live data finishes loading, so keep that listener and any later delegated
listener in sync for both `.standings-row[data-team]` and
`.third-place-row[data-team]`. If the early listener is narrower and sets the
shared `_hasTeamListener` flag, later renders will not attach the broader
handler and the third-place table will look clickable while doing nothing.

The Bracket tab has two display modes. `Live Bracket` should use confirmed
group seeds, Annex C third-place paths, and FT knockout winners only; it must
not fall back to local user picks. `My Picks` should use the user's saved manual
predictions first for unresolved slots, while confirmed teams fill blank slots.
Store the first saved pick for each slot in `wc2026bracketOriginal`; live data
may change what is displayed, but it must not overwrite the user's original
prediction.

Bracket match cards display knockout dates and kickoff times in the user's
local timezone plus the host city. Stadium names stay in the canonical schedule
data but are intentionally omitted from compact bracket cards.
`knockout-bracket.js` is the canonical static source for FIFA match numbers,
dates, venues, and advancement paths. The Bracket tab, Matches
tab, and next-match banner must all resolve teams through this graph; do not
copy pairings into another UI component. The graph follows FIFA Matches 73-104,
including Match 103 (`L M101` vs `L M102`) and Match 104 (`W M101` vs `W M102`).
Keep schedule formatting in the client layer; it is presentation data, not a
serverless live-data computation.

The Bracket tab renders that graph differently by viewport without changing its
meaning. Desktop uses one mirrored tournament tree with the final in the
center. Mobile uses standard round tabs: `R32`, `R16`, `QF`, `SF`, and `Final`.
Each tab renders a connected two-column stage window (`R32 -> R16`,
`R16 -> QF`, `QF -> SF`, or `SF -> Final`) from the same official match graph.
The first rounds scroll vertically, while later stages collapse to their content
height so all remaining paths fit together without inherited empty rows. The
Final view pairs Match 104 with the champion and keeps Match 103 visible below.
The mobile page and bracket must not overflow horizontally.
Official match IDs remain on the cards, where they identify individual fixtures
without replacing fan-facing round names. Confirmed teams use consistent
three-letter codes in the compact mobile tree, while unresolved structural
slots remain `W M...` or `L M...` until a team is known. Full team names remain
in accessibility labels and on desktop. The bracket description is collapsed by
default without hiding the Live/My Picks control. Group Seeds remain below the
bracket in an independently expandable disclosure whose header and body share
one border and background. Disclosure state and the
selected mobile stage survive Live/My Picks rerenders. Both layouts must be
generated from the same resolved match models and official match IDs, never from
separate progression data.

Mobile match nodes use an explicit 72px height and 6px source gap. A single SVG
path spans each 18px connector column at source-center positions 24% and 76%, so
the two arms, merge spine, and target arm are one continuous stroke. Do not
reintroduce separately positioned border fragments; even a small gap changes the
source-center percentages and creates visibly disconnected corners. The compact
height retains both teams, scores, local kickoff, and city.

The appearance control lives in the navigation rail. On mobile this removes the
otherwise empty action row from Bracket and Stats while retaining a 44px target.
The default remains `system`, following platform appearance unless the user
explicitly cycles to light or dark; the preference remains in `wc2026-theme`.

The mobile interaction borrows two established patterns: ESPN has documented a
vertical bracket with swipe navigation and explicit round jumps, while FotMob's
World Cup knockout view makes the bracket the dominant surface and compacts
later rounds. This app keeps the explicit round tabs but limits the viewport to
two connected stages so cards remain readable and selectable.

Original-pick comparisons use a compact history icon plus three-letter team
code in the match header. Keep the full `Original pick: Team` value in the
tooltip and accessibility label. Never put a full team name in that compact
header; it can overflow the narrow mobile match node.

Older releases stored later-round picks under aliases such as `R16_0`, `QF_0`,
and `FINAL`. `migrateLegacyBracketMatchIds()` maps those keys to FIFA match IDs
without overwriting an existing new-format pick. Do not remove that migration
while installed PWAs may still hold legacy localStorage.

The Matches tab also renders knockout fixtures from the static schedule, but it
must progressively replace placeholders with live data when available. Round of
32 cards should resolve `1A`, `2A`, and Annex C third-place slots from
`standingsData` and `thirdPlaceData`; later knockout cards should resolve only
from actual FT knockout winners. Penalty-decided matches must include an
explicit `winner` (and `hp`/`ap` when available) in `actualScores`; a tied FT
score alone cannot advance a team. Keep the static `TBD`, `Best 3rd`, and
group-position labels as fallbacks until the live data can prove the team.

Keep compact mobile copy intentional. Short subtitles such as the third-place
race note should avoid awkward orphan phrases on narrow screens. Prefer shorter
phrasing like "may decide ties" over long phrases that wrap as isolated words.

The client only renders that payload. It does not call third-party APIs or infer whether a game is complete.

## Freshness And Failure Behavior

- Successful `/api/data` responses use adaptive CDN caching:
  `settlement` windows use `s-maxage=120`, normal match windows use
  `s-maxage=900`, and quiet windows use `s-maxage=1800`.
- Vercel's CDN absorbs repeat traffic and refreshes data after the current
  response's `s-maxage` expires.
- The installed PWA has its own Cache API and `localStorage`; it does not automatically inherit a fresher payload just because Vercel's CDN has one.
- Normal `/api/data` service-worker reads are stale-while-revalidate for fast startup, but app startup sends `cache: "reload"` with `Cache-Control: no-cache` so iOS Home Screen launches perform a deterministic network refresh.
- `/api/data` includes `meta.dataVersion` and an `ETag` based on the football
  payload, not `updatedAt`. The app and service worker compare this stable
  version before re-rendering or showing an update toast.
- `meta.dataVersion` must include every dynamic field that can change what the
  UI shows, including `actualScores`, `standingsData`, `thirdPlaceData`, and
  `statsData`. If a new UI reads a new field from an existing cached object but
  that field was omitted from the version hash, installed PWAs can receive `304
  Not Modified`, keep stale `localStorage`, and show fallback text even though
  the app shell updated.
- Add a schema guard for cached dynamic data whenever a new required dynamic
  field is introduced. Stale cached objects should be discarded before the
  initial render, then replaced by a forced fresh `/api/data` fetch.
- The app pulls fresh data on startup, focus, and `visibilitychange`, then
  schedules foreground-only refreshes from `meta.nextRefreshSeconds`. Closed or
  backgrounded PWAs update on the next foreground launch/focus.
- A non-2xx API response or network failure falls back to that cached response.
- Dynamic data is only allowed to move forward by completed-match count, so an older bundled snapshot cannot overwrite newer FT scores, standings, or stats already seen by the PWA.
- A first-time offline visitor falls back to `data.json`, which may be older and should be treated as a bundled snapshot.
- The service worker, HTML, app script, and snapshot use network-first reads to avoid stale app-shell deployments.

There is deliberately no sub-daily Vercel Cron Job. As of June 2026, Hobby cron jobs may run only once per day and with hourly timing precision. A more frequent expression fails deployment. On-demand CDN revalidation is simpler and fits this app's post-match, non-live use case.

## Vercel Hobby Compatibility

- One Node.js Function: `api/data.js`.
- Function `maxDuration` is 45 seconds. This is below the 60-second legacy Hobby maximum and the 300-second Fluid Compute Hobby maximum.
- No database, durable queue, paid scheduler, or Edge Config is required.
- No cron configuration is present.
- Function responses are well below Vercel's 4.5 MB response limit.

Current platform references:

- [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Function limits](https://vercel.com/docs/functions/limitations)
- [Configuring function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel CDN cache](https://vercel.com/docs/cdn-cache)
- [Vercel Hobby plan](https://vercel.com/docs/accounts/plans/hobby)

## Data Validation

The upstream feed is untrusted input. The function allowlists the 48 teams in `data.json`, requires integer scores from 0 through 99, ignores unresolved scorer names, and never marks a game FT without both scores. This follows OWASP's guidance to validate data from partner and supplier feeds: [Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

Scorer strings from the upstream feed are not treated as complete event data.
They can contain inconsistent transliteration, unlabeled own goals, missing
tokens, and unusual stoppage-time formats. Known verified corrections live in
`data/scorer-overrides.json` with source URLs. After building `/api/data`, the
function validates that each finished match has scorer labels equal to the final
score total and reports `meta.scorerCompleteness`.

When scorer labels are incomplete, or when a match has recently finished, the
serverless function can attempt bounded scorer verification from free sources.
API-Football is supported only when `API_FOOTBALL_SCORERS=1` and an
`API_FOOTBALL_KEY` or `APIFOOTBALL_KEY` is configured. ESPN's public World Cup
endpoint and TheSportsDB's free v1 API are attempted without secrets. These
sources run server-side only; the PWA never calls them directly. A source is
accepted only when its scoring events match the final score total by side. The
response includes `meta.scorerResolution` so operators can see which matches
were checked, which source was accepted, and which matches fell back to the
feed/parser path.

Because free API quotas are fragile and Vercel Functions have no durable local
disk cache, the verifier is intentionally bounded per invocation. Tune
`SCORER_VERIFIER_MAX_MATCHES` and `SCORER_VERIFIER_RECENT_HOURS` conservatively,
and rely on Vercel CDN caching to keep repeated PWA launches from re-querying
external providers on every request.

The parser should fix recurring feed patterns at the resolver layer, not with
one-off display patches. For example, the feed often writes vowels as `v` or
uses nearby transliterations (`Jvlian Kviinvnz`, `Svfian Rhimi`, `Taplv Maskv`),
so scorer resolution uses a consonant/skeleton match against the known squad
list. Use explicit aliases only when the feed loses semantic information, such
as an own goal token without an `(OG)` marker.

The schedule-aware completeness check prevents a partial feed from silently removing finals. It uses the tournament's June/July Eastern Time schedule and allows four hours from kickoff before requiring a final result.

FIFA remains the manual cross-check for fixtures and published statistics:

- [FIFA match schedule and results](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums)
- [FIFA tournament statistics](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stats)
- [FIFA 2026 group tie-break rules](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/group-stage-permutations-qualify)

## Release Checklist

1. Run `npm run check`.
2. Run `BRACKET_SMOKE_API_URL=https://wc26.medina.contact/api/data npm run smoke:bracket -- http://127.0.0.1:4173/#bracket` when the Bracket tab changes.
3. For Groups tab changes, verify normal standings rows and third-place rows both open the team modal.
4. Run `vercel build` to validate the deployment configuration.
5. Deploy with `npm run deploy`.
6. Verify `/service-worker.js` reports the expected cache version.
7. Verify `/api/data` returns HTTP 200, nonzero stats, and all matches older than four hours have `status: "FT"`.
8. Verify `/api/data` reports `meta.scorerCompleteness: "verified"` and `meta.scorerIssueCount: 0`.
9. Verify completed or mathematically settled groups expose the expected standings `status` labels, while open groups do not show speculative badges.
10. Test Groups, Matches, Bracket, Stats, search, and theme controls in a fresh browser tab.
11. In an installed PWA or simulated service-worker session, confirm reopening the app refreshes `/api/data` with a no-cache request and does not downgrade from a newer local payload to the bundled snapshot.
12. Confirm response security and cache headers on the production domain.

For a branch preview, run `npm run stamp-sw` and then `vercel --yes` without
`--prod`. This gives the preview a distinct service-worker byte stamp while
leaving the production alias untouched. Run the bracket smoke against the
returned preview URL before merging. Protected previews require the project's
automation bypass in `VERCEL_AUTOMATION_BYPASS_SECRET`; the smoke runner sends
it as `x-vercel-protection-bypass` and requests a browser cookie for subsequent
assets. Retrieve the value at execution time and never print, persist, or commit
it. Production remains `npm run deploy` only.

Use `npm run deploy` for production releases, including serverless-only changes
that alter visible scores, standings, stats, or refresh behavior. The
`stamp-sw` step changes `service-worker.js` bytes so installed PWAs can detect a new
version and show the update confirmation on next launch/focus. Raw
`vercel --prod` is only appropriate for backend changes that should remain
invisible to the installed app shell.

## Incident Checks

If finals disappear or predictions return for old matches:

1. Inspect `/api/data` before debugging the UI.
2. A 502 with `missingFinals` means the upstream feed is incomplete; the PWA should retain its last good payload.
3. A 200 without the expected FT is a regression in server validation and must block release.
4. Check the production HTML and service-worker cache version to confirm the newest deployment is actually aliased.
5. Confirm `vercel.json` contains no Hobby-incompatible cron schedule.
