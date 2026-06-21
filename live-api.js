// =============================================================================
// LIVE API INTEGRATION — /api/scores proxy (backed by TheSportsDB)
// Fetches final match scores and merges them into actualScores.
// The proxy caches responses at Vercel's CDN edge for 15 minutes.
// KILL-SWITCH: Set LIVE_API_ENABLED to false to use only data.json.
// =============================================================================

var LIVE_API_ENABLED = true;
var LIVE_API_DEBOUNCE = 900000; // 15 min between fetches per session
var LIVE_API_DEBUG = false;

var _liveDataReady = false;
var _liveLastFetch = 0;

function _liveLog() {
  if (LIVE_API_DEBUG) console.log.apply(console, ['[LiveAPI]'].concat(Array.prototype.slice.call(arguments)));
}

// =============================================================================
// MAIN FETCH
// =============================================================================
function liveApiFetch() {
  if (!LIVE_API_ENABLED) return Promise.resolve(false);
  _liveLog('Fetching /api/scores...');

  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function() { if (controller) controller.abort(); }, 8000);
  var opts = controller ? { signal: controller.signal } : {};

  var fetchScores = fetch('/api/scores', opts)
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .catch(function() { return null; });

  var fetchStandings = fetch('/api/standings', opts)
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .catch(function() { return null; });

  return Promise.all([fetchScores, fetchStandings])
    .then(function(results) {
      clearTimeout(timer);
      var scoresData = results[0];
      var standingsData_ = results[1];
      var anyUpdate = false;

      if (scoresData) {
        var newScores = scoresData.scores || {};
        var count = Object.keys(newScores).length;
        if (count > 0) {
          Object.keys(newScores).forEach(function(k) { actualScores[k] = newScores[k]; });
          anyUpdate = true;
          _liveLog('Merged', count, 'scores from proxy');
        }
      }

      if (standingsData_) {
        var newStandings = standingsData_.standings || {};
        if (Object.keys(newStandings).length > 0) {
          standingsData = newStandings;
          anyUpdate = true;
          _liveLog('Updated standings for', Object.keys(newStandings).length, 'groups');
        }
      }

      if (anyUpdate) {
        _liveDataReady = true;
        _liveLastFetch = Date.now();
      }
      return anyUpdate;
    })
    .catch(function(err) {
      clearTimeout(timer);
      _liveLog('Fetch failed:', err.message);
      return false;
    });
}

// =============================================================================
// DEBOUNCED REFRESH
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
    var activeContent = document.querySelector('.tab-content.active');
    if (activeContent) activeTab = activeContent.id.replace('tab-', '');
  }
  if (activeTab && renderedTabs[activeTab]) {
    renderedTabs[activeTab] = false;
    ensureTabRendered(activeTab);
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================
function liveApiInit() {
  if (!LIVE_API_ENABLED) {
    _liveLog('Disabled via LIVE_API_ENABLED flag');
    return Promise.resolve(false);
  }
  return liveApiFetch().then(function(success) {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) _liveDebouncedFetch();
    });
    return success;
  });
}
