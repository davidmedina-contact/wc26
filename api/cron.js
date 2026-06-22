// Vercel Cron warm-up endpoint.
// Triggers fresh reads of the live-data serverless routes so CDN cache picks up
// FT scores, group tables, and stats after the match window.

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function warm(url) {
  const res = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });
  return {
    url,
    ok: res.ok,
    status: res.status,
  };
}

module.exports = async (req, res) => {
  const origin = getOrigin(req);
  const startedAt = new Date().toISOString();

  const results = await Promise.all([
    warm(`${origin}/api/data`),
    warm(`${origin}/api/standings`),
    warm(`${origin}/api/scores`),
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ok: true,
    startedAt,
    results,
  });
};
