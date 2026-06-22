// Serverless proxy: derives finished match scores from the live games feed.
// Returns { scores: { "Home_Away": { h, a, status } } } with CDN cache.

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

async function fetchJson(url, timeoutMs) {
  const proxyUrl = 'https://r.jina.ai/' + url.replace(/^https?:\/\//, 'http://');
  const direct = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => r.text())
    .catch(() => null);
  if (direct) {
    try { return JSON.parse(direct); } catch (e) {}
  }
  const proxied = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs + 5000) })
    .then(r => r.text())
    .catch(() => null);
  if (!proxied) return null;
  const start = proxied.indexOf('{');
  const end = proxied.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(proxied.slice(start, end + 1)); } catch (e) {}
  }
  return null;
}

module.exports = async (req, res) => {
  const gamesRes = await fetchJson('http://worldcup26.ir/get/games', 10000);
  const scores = {};

  for (const e of (gamesRes?.games || [])) {
    if (String(e.finished).toUpperCase() !== 'TRUE') continue;
    const home = norm(e.home_team_name_en || '');
    const away = norm(e.away_team_name_en || '');
    if (home && away) {
      scores[`${home}_${away}`] = {
        h: parseInt(e.home_score) || 0,
        a: parseInt(e.away_score) || 0,
        status: 'FT',
      };
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ scores, updatedAt: new Date().toISOString() });
};
