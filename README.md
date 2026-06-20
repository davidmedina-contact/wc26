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

Plain HTML, CSS, and JavaScript — no build step, no framework, no dependencies.

| File | Purpose |
|---|---|
| `index.html` | Shell, critical CSS, theme init, service worker registration |
| `app.js` | All UI rendering and interactivity |
| `live-api.js` | Live score / data fetching |
| `style.css` | Full stylesheet (design tokens + components) |
| `data.json` | Teams, squads, groups, matches, ELO ratings, predictions |
| `manifest.json` | PWA manifest |
| `service-worker.js` | Offline caching + background updates |
| `vercel.json` | Cache-control headers for each asset |

## Deployment

Deployed on Vercel. Push to `main` to trigger a new deployment.

```bash
vercel --prod
```

## Local Development

No install required. Serve the files with any static server:

```bash
npx serve .
```
