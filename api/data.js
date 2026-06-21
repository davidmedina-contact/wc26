// Combined bootstrap payload for the client.
// Returns the static snapshot plus live final scores and standings.

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3/eventsday.php';
const SNAPSHOT = require('../data.json');

const NAME_MAP = { 'USA': 'United States', 'Turkey': 'Türkiye' };
function norm(name) { return NAME_MAP[name] || name; }

function dateStr(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchScores() {
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
      if (home && away) {
        scores[`${home}_${away}`] = {
          h: parseInt(e.intHomeScore) || 0,
          a: parseInt(e.intAwayScore) || 0,
          status: 'FT',
        };
      }
    }
  }
  return scores;
}

async function fetchStandings() {
  const [groupsRes, teamsRes] = await Promise.all([
    fetch('https://worldcup26.ir/get/groups', { signal: AbortSignal.timeout(10000) })
      .then(r => r.json()).catch(() => null),
    fetch('https://worldcup26.ir/get/teams', { signal: AbortSignal.timeout(10000) })
      .then(r => r.json()).catch(() => null),
  ]);

  const apiGroups = groupsRes?.groups || [];
  const apiTeams = teamsRes?.teams || [];
  if (!apiGroups.length || !apiTeams.length) return {};

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

  return standings;
}

module.exports = async (req, res) => {
  const [scores, standings] = await Promise.all([fetchScores(), fetchStandings()]);
  const data = JSON.parse(JSON.stringify(SNAPSHOT));

  data.actualScores = Object.assign({}, data.actualScores, scores);
  if (Object.keys(standings).length > 0) data.standingsData = standings;

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data, updatedAt: new Date().toISOString() });
};
