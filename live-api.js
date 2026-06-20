// =============================================================================
// LIVE API INTEGRATION — worldcup26.ir
// =============================================================================
// This module fetches live match scores, group standings, and knockout bracket
// results from the worldcup26.ir API. It overlays live data on top of the
// static data.json without modifying it.
//
// KILL-SWITCH: Set LIVE_API_ENABLED to false to completely disable all API calls.
// The app will revert to using only data.json (semi-manual update system).
// =============================================================================

var LIVE_API_ENABLED = true;
var LIVE_API_BASE = 'https://worldcup26.ir';
var LIVE_API_TIMEOUT = 8000; // ms
var LIVE_API_DEBOUNCE = 900000; // min 15 minutes between fetches
var LIVE_API_DEBUG = false; // set true for console logging

// Internal state
var _liveDataReady = false;
var _liveLastFetch = 0;

// Team name mapping: API names -> our app's names
var _liveTeamNameMap = {
  'Turkey': 'Türkiye',
  'Democratic Republic of the Congo': 'DR Congo'
};

function _liveNormalizeTeam(name) {
  return _liveTeamNameMap[name] || name;
}

function _liveLog() {
  if (LIVE_API_DEBUG) console.log.apply(console, ['[LiveAPI]'].concat(Array.prototype.slice.call(arguments)));
}

// Fetch with timeout
function _liveFetch(endpoint) {
  return new Promise(function(resolve, reject) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function() {
      if (controller) controller.abort();
      reject(new Error('Timeout'));
    }, LIVE_API_TIMEOUT);

    var opts = {};
    if (controller) opts.signal = controller.signal;

    fetch(LIVE_API_BASE + endpoint, opts)
      .then(function(res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(resolve)
      .catch(function(err) {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// =============================================================================
// TRANSFORM: API games -> actualScores format
// Our format: { "HomeTeam_AwayTeam": { h: number, a: number, status: "FT" } }
// =============================================================================
function _liveTransformScores(apiGames) {
  var scores = {};
  apiGames.forEach(function(g) {
    if (g.finished !== 'TRUE') return;
    var home = _liveNormalizeTeam(g.home_team_name_en || '');
    var away = _liveNormalizeTeam(g.away_team_name_en || '');
    if (!home || !away) return;
    var key = home + '_' + away;
    scores[key] = {
      h: parseInt(g.home_score) || 0,
      a: parseInt(g.away_score) || 0,
      status: 'FT'
    };
  });
  return scores;
}

// =============================================================================
// TRANSFORM: API groups -> standingsData format
// Our format: { "A": [{ t: "Mexico", p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 0, gd: 2, pts: 3 }, ...] }
// API provides team_id references; we need to resolve them to team names.
// =============================================================================
function _liveTransformStandings(apiGroups, apiTeams) {
  // Build team_id -> name lookup
  var teamById = {};
  apiTeams.forEach(function(t) {
    teamById[t.id] = _liveNormalizeTeam(t.name_en);
  });

  var standings = {};
  apiGroups.forEach(function(group) {
    var letter = group.name;
    var teams = (group.teams || []).map(function(t) {
      return {
        t: teamById[t.team_id] || ('Team ' + t.team_id),
        p: parseInt(t.mp) || 0,
        w: parseInt(t.w) || 0,
        d: parseInt(t.d) || 0,
        l: parseInt(t.l) || 0,
        gf: parseInt(t.gf) || 0,
        ga: parseInt(t.ga) || 0,
        gd: parseInt(t.gd) || 0,
        pts: parseInt(t.pts) || 0
      };
    });
    // Sort: by pts desc, then gd desc, then gf desc
    teams.sort(function(a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    standings[letter] = teams;
  });
  return standings;
}

// =============================================================================
// TRANSFORM: API games -> bracket knockout results
// Populates bracketState with actual results for finished knockout games.
// Maps game type/id to our bracket keys (ko_M73, ko_R16_0, etc.)
// =============================================================================
function _liveTransformBracket(apiGames) {
  var knockoutResults = {};

  // Build R32 results: API game IDs 73-88 map to M73-M88
  // Build R16 results: API game IDs 89-96
  // Build QF results: API game IDs 97-100
  // Build SF results: API game IDs 101-102
  // Build 3rd place: API game ID 103
  // Build Final: API game ID 104

  apiGames.forEach(function(g) {
    if (g.finished !== 'TRUE') return;
    if (g.type === 'group') return;

    var home = _liveNormalizeTeam(g.home_team_name_en || '');
    var away = _liveNormalizeTeam(g.away_team_name_en || '');
    if (!home || !away) return;

    var homeScore = parseInt(g.home_score) || 0;
    var awayScore = parseInt(g.away_score) || 0;
    var winner = homeScore >= awayScore ? home : away; // Simplified; penalties not tracked

    var gameId = parseInt(g.id);

    if (gameId >= 73 && gameId <= 88) {
      // Round of 32
      knockoutResults['ko_M' + gameId] = winner;
    } else if (gameId >= 89 && gameId <= 96) {
      // Round of 16
      var r16Idx = gameId - 89;
      knockoutResults['ko_R16_' + r16Idx] = winner;
    } else if (gameId >= 97 && gameId <= 100) {
      // Quarter-finals
      var qfIdx = gameId - 97;
      knockoutResults['ko_QF_' + qfIdx] = winner;
    } else if (gameId >= 101 && gameId <= 102) {
      // Semi-finals
      var sfIdx = gameId - 101;
      knockoutResults['ko_SF_' + sfIdx] = winner;
    } else if (gameId === 104) {
      // Final
      knockoutResults['ko_FINAL'] = winner;
    }
  });

  return knockoutResults;
}

// Also extract group winners/runners-up for bracket display
function _liveTransformGroupResults(standings) {
  var results = {};
  Object.keys(standings).forEach(function(letter) {
    var teams = standings[letter];
    if (teams.length >= 1 && teams[0].p > 0) results['g_' + letter + '_1'] = teams[0].t;
    if (teams.length >= 2 && teams[1].p > 0) results['g_' + letter + '_2'] = teams[1].t;
    if (teams.length >= 3 && teams[2].p > 0) results['g_' + letter + '_3'] = teams[2].t;
  });
  return results;
}

// =============================================================================
// MAIN FETCH: Pull all live data and apply to app globals
// =============================================================================
function liveApiFetch() {
  if (!LIVE_API_ENABLED) return Promise.resolve(false);

  _liveLog('Fetching live data...');

  return Promise.all([
    _liveFetch('/get/games'),
    _liveFetch('/get/groups'),
    _liveFetch('/get/teams')
  ]).then(function(results) {
    var gamesData = results[0];
    var groupsData = results[1];
    var teamsData = results[2];

    var apiGames = gamesData.games || [];
    var apiGroups = groupsData.groups || [];
    var apiTeams = teamsData.teams || [];

    // Transform and apply scores
    var liveScores = _liveTransformScores(apiGames);
    if (Object.keys(liveScores).length > 0) {
      actualScores = liveScores;
      _liveLog('Updated scores:', Object.keys(liveScores).length, 'matches');
    }

    // Transform and apply standings
    var liveStandings = _liveTransformStandings(apiGroups, apiTeams);
    if (Object.keys(liveStandings).length > 0) {
      standingsData = liveStandings;
      _liveLog('Updated standings for', Object.keys(liveStandings).length, 'groups');
    }

    // Transform and apply bracket knockout results
    var liveKnockout = _liveTransformBracket(apiGames);
    if (Object.keys(liveKnockout).length > 0) {
      // Merge knockout results into bracketState (don't overwrite user picks for future games)
      Object.keys(liveKnockout).forEach(function(key) {
        bracketState[key] = liveKnockout[key];
      });
      _liveLog('Updated bracket:', Object.keys(liveKnockout).length, 'knockout results');
    }

    // Apply group results to bracket (who qualified)
    var groupResults = _liveTransformGroupResults(liveStandings);
    Object.keys(groupResults).forEach(function(key) {
      bracketState[key] = groupResults[key];
    });

    _liveDataReady = true;
    _liveLastFetch = Date.now();
    _liveLog('Live data applied successfully');

    return true;
  }).catch(function(err) {
    _liveLog('Fetch failed (using static data):', err.message);
    return false;
  });
}

// =============================================================================
// DEBOUNCED REFRESH: Only fetch if enough time has passed since last fetch
// =============================================================================
function _liveDebouncedFetch() {
  if (!LIVE_API_ENABLED) return;
  if (Date.now() - _liveLastFetch < LIVE_API_DEBOUNCE) return;
  liveApiFetch().then(function(updated) {
    if (updated) _liveRefreshUI();
  });
}

// Re-render currently visible tab after live data update
function _liveRefreshUI() {
  var activeTab = document.body.getAttribute('data-active-tab');
  if (!activeTab) {
    // Find active tab from DOM
    var activeContent = document.querySelector('.tab-content.active');
    if (activeContent) activeTab = activeContent.id.replace('tab-', '');
  }

  // Force re-render by clearing cached state
  if (activeTab && renderedTabs[activeTab]) {
    renderedTabs[activeTab] = false;
    ensureTabRendered(activeTab);
  }
}

// =============================================================================
// INITIALIZATION: Called after data.json is loaded in init()
// =============================================================================
function liveApiInit() {
  if (!LIVE_API_ENABLED) {
    _liveLog('Disabled via LIVE_API_ENABLED flag');
    return Promise.resolve(false);
  }

  // Fetch once on page load
  return liveApiFetch().then(function(success) {
    // Fetch again when tab regains focus (debounced)
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) _liveDebouncedFetch();
    });
    return success;
  });
}
