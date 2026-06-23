# FIFA World Cup 2026 Interactive Guide

A single-page web app for following the 2026 FIFA World Cup. Installable as a PWA (Progressive Web App).

## Features

- **Groups** — Live standings table for all 12 groups. Click any team to open a squad modal with full roster, top 5 players, manager info, and squad analysis.
- **Matches** — Schedule browser by date with kickoff times, broadcast networks (FOX/FS1/Telemundo/etc.), and win/draw/loss probability.
- **Bracket** — Interactive elimination bracket. Pick group stage finishers and knockout round winners through the Final.
- **Stats** — Tournament stats: top scorers, goals by group, confederation breakdown, and records.
- **Search** — Global search by team name or player name.
- **Dark/light/system theme** toggle (persisted to `localStorage`).
- **ICS file** — `world-cup-2026-schedule.ics` for importing the full schedule into any calendar app.

## Stack

Plain HTML, CSS, and JavaScript - no build step, no framework, and no runtime dependencies.

| File | Purpose |
|---|---|
| `index.html` | Shell, critical CSS, theme init, service worker registration |
| `app.js` | All UI rendering and interactivity |
| `style.css` | Full stylesheet (design tokens + components) |
| `data.json` | Teams, squads, groups, matches, ELO ratings, predictions |
| `api/data.js` | Serverless live-data validation, final scores, standings, and stats |
| `manifest.json` | PWA manifest |
| `service-worker.js` | Offline caching + background updates |
| `vercel.json` | Hobby-compatible function and cache configuration |

## Data Flow

The browser makes one same-origin request to `/api/data`. The Vercel Function fetches the match feed, validates completed games, and derives final scores, group standings, and tournament statistics from the same records. The browser does not contact the upstream provider or calculate live tournament data.

Successful responses are cached at Vercel's CDN for 15 minutes. The service worker also retains the last successful `/api/data` response, so a temporary upstream error does not replace known finals with predictions. If there is no cached response, the bundled `data.json` snapshot remains the offline fallback.

See [Operations](docs/OPERATIONS.md) for failure behavior, Vercel Hobby constraints, and the release checklist.

## Deployment

Deployed on Vercel Hobby. Use the project deploy script for production
releases:

```bash
npm run deploy
```

That script stamps `service-worker.js` and then runs `vercel --prod --yes`.
The stamp is required for installed PWAs to detect a new app version and show
the update confirmation on next launch/focus. Do not use bare `vercel --prod`
or rely only on a GitHub push for visible app changes, including serverless
changes that affect scores, standings, stats, or refresh behavior.

After deploying, commit and push the stamped `service-worker.js` so GitHub and
the Vercel deployment stay at parity.

Do not add sub-daily Vercel cron expressions on Hobby. Vercel rejects the entire deployment when a cron runs more than once per day.

## Local Development

Run the dependency-free checks:

```bash
npm test
npm run check
```

Run the complete app and serverless function through Vercel's local runtime:

```bash
vercel dev
```

A plain static server still works for UI development, but `/api/data` will be unavailable and the app will use the bundled snapshot.
