// Serverless proxy: derives finished match scores from the live games feed.
// Returns { scores: { "Home_Away": { h, a, status } } } with CDN cache.

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

async function fetchJson(url, timeoutMs) {
  const proxyUrl = 'https://r.jina.ai/' + url.replace(/^https?:\/\//, 'http://');
  async function request(candidate, timeout) {
    const response = await fetch(candidate, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.text();
    try { return JSON.parse(body); } catch (e) {
      const start = body.indexOf('{');
      const end = body.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
      throw e;
    }
  }
  return Promise.any([
    request(url, timeoutMs),
    request(proxyUrl, timeoutMs + 5000),
  ]).catch(() => null);
}

module.exports = async (req, res) => {
  const gamesRes = await fetchJson('https://worldcup26.ir/get/games', 20000);
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
