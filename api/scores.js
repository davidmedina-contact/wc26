// Serverless proxy: fetches WC match scores from TheSportsDB for yesterday/today/tomorrow
// Returns { scores: { "Home_Away": { h, a, status } } } with 15-min CDN cache.

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3/eventsday.php';

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

function dateStr(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  const dates = [dateStr(-1), dateStr(0), dateStr(1)];

  const results = await Promise.all(
    dates.map(d =>
      fetch(`${TSDB}?d=${d}&s=Soccer`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.json())
        .catch(() => null)
    )
  );

  const scores = {};
  for (const result of results) {
    for (const e of (result?.events || [])) {
      if (!e.strLeague?.includes('World Cup')) continue;
      if (!['FT', 'AET', 'PEN'].includes(e.strStatus)) continue;
      const home = norm(e.strHomeTeam || '');
      const away = norm(e.strAwayTeam || '');
      if (home && away) scores[`${home}_${away}`] = {
        h: parseInt(e.intHomeScore) || 0,
        a: parseInt(e.intAwayScore) || 0,
        status: 'FT',
      };
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ scores, updatedAt: new Date().toISOString() });
};
