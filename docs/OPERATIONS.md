# Operations

## Architecture

`/api/data` is the only live-data boundary. It performs four jobs before returning a payload:

1. Race the upstream match feed against a read-only proxy fallback.
2. Read the provider's ordered group table as an optional tie-break authority.
3. Accept only known teams, valid integer scores, and games explicitly marked finished.
4. Derive FT scores and stats from the same accepted records.
5. Reject incomplete data once a scheduled match is four hours past kickoff.

The ordered table is accepted only when every row is internally consistent and its total matches played agrees with the accepted game records. If it is unavailable or lagging, the function computes a points/goal-difference table from the games. This fallback keeps the app usable, while the ordered feed preserves FIFA's 2026 head-to-head tie-break rules when teams are level.

The client only renders that payload. It does not call third-party APIs or infer whether a game is complete.

## Freshness And Failure Behavior

- Successful `/api/data` responses use `s-maxage=900, stale-while-revalidate=60`.
- Vercel's CDN absorbs repeat traffic and normally refreshes data within 15 minutes of expiry.
- The service worker uses network-first reads and stores the last successful response at the stable `/api/data` URL.
- A non-2xx API response or network failure falls back to that cached response.
- A first-time offline visitor falls back to `data.json`, which may be older and should be treated as a bundled snapshot.
- The service worker, HTML, app script, and snapshot use network-first reads to avoid stale app-shell deployments.

There is deliberately no sub-daily Vercel Cron Job. As of June 2026, Hobby cron jobs may run only once per day and with hourly timing precision. A more frequent expression fails deployment. On-demand CDN revalidation is simpler and fits this app's post-match, non-live use case.

## Vercel Hobby Compatibility

- One Node.js Function: `api/data.js`.
- Function `maxDuration` is 30 seconds. This is below the 60-second legacy Hobby maximum and the 300-second Fluid Compute Hobby maximum.
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

The schedule-aware completeness check prevents a partial feed from silently removing finals. It uses the tournament's June/July Eastern Time schedule and allows four hours from kickoff before requiring a final result.

FIFA remains the manual cross-check for fixtures and published statistics:

- [FIFA match schedule and results](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums)
- [FIFA tournament statistics](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stats)
- [FIFA 2026 group tie-break rules](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/group-stage-permutations-qualify)

## Release Checklist

1. Run `npm run check`.
2. Run `vercel build` to validate the deployment configuration.
3. Deploy with `vercel --prod`.
4. Verify `/service-worker.js` reports the expected cache version.
5. Verify `/api/data` returns HTTP 200, nonzero stats, and all matches older than four hours have `status: "FT"`.
6. Test Groups, Matches, Bracket, Stats, search, and theme controls in a fresh browser tab.
7. Confirm response security and cache headers on the production domain.

## Incident Checks

If finals disappear or predictions return for old matches:

1. Inspect `/api/data` before debugging the UI.
2. A 502 with `missingFinals` means the upstream feed is incomplete; the PWA should retain its last good payload.
3. A 200 without the expected FT is a regression in server validation and must block release.
4. Check the production HTML and service-worker cache version to confirm the newest deployment is actually aliased.
5. Confirm `vercel.json` contains no Hobby-incompatible cron schedule.
