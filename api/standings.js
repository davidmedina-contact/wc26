// Proxy: worldcup26.ir /get/groups + /get/teams -> standingsData format
// Returns { standings: { "A": [{t,p,w,d,l,gf,ga,gd,pts},...], ... } }

const NAME_MAP = { 'Turkey': 'Türkiye', 'Democratic Republic of the Congo': 'DR Congo' };
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
  const [groupsRes, teamsRes] = await Promise.all([
    fetchJson('https://worldcup26.ir/get/groups', 20000),
    fetchJson('https://worldcup26.ir/get/teams', 20000),
  ]);

  const apiGroups = groupsRes?.groups || [];
  const apiTeams = teamsRes?.teams || [];

  if (!apiGroups.length || !apiTeams.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.json({ standings: {} });
  }

  const teamById = {};
  apiTeams.forEach(t => { teamById[t.id] = norm(t.name_en); });

  const standings = {};
  apiGroups.forEach(group => {
    const letter = group.name;
    const teams = (group.teams || []).map(t => ({
      t: teamById[t.team_id] || ('Team ' + t.team_id),
      p: parseInt(t.mp) || 0,
      w: parseInt(t.w) || 0,
      d: parseInt(t.d) || 0,
      l: parseInt(t.l) || 0,
      gf: parseInt(t.gf) || 0,
      ga: parseInt(t.ga) || 0,
      gd: parseInt(t.gd) || 0,
      pts: parseInt(t.pts) || 0,
    }));
    teams.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    standings[letter] = teams;
  });

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ standings, updatedAt: new Date().toISOString() });
};
