(function(root, factory) {
  var bracket = factory();
  if (typeof module === 'object' && module.exports) module.exports = bracket;
  root.KnockoutBracket = bracket;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  // FIFA's official match graph. Keep every knockout consumer on this one source.
  var matches = [
    {id:'M73', stage:'r32', d:'2026-06-28', t:'15:00', v:'Los Angeles (SoFi)', h:'2A', a:'2B'},
    {id:'M76', stage:'r32', d:'2026-06-29', t:'13:00', v:'Houston (NRG)', h:'1C', a:'2F'},
    {id:'M74', stage:'r32', d:'2026-06-29', t:'16:30', v:'Boston (Gillette)', h:'1E', a:'3 A/B/C/D/F'},
    {id:'M75', stage:'r32', d:'2026-06-29', t:'21:00', v:'Monterrey (BBVA)', h:'1F', a:'2C'},
    {id:'M78', stage:'r32', d:'2026-06-30', t:'13:00', v:'Dallas (AT&T)', h:'2E', a:'2I'},
    {id:'M77', stage:'r32', d:'2026-06-30', t:'17:00', v:'New Jersey (MetLife)', h:'1I', a:'3 C/D/F/G/H'},
    {id:'M79', stage:'r32', d:'2026-06-30', t:'21:00', v:'Mexico City (Azteca)', h:'1A', a:'3 C/E/F/H/I'},
    {id:'M80', stage:'r32', d:'2026-07-01', t:'12:00', v:'Atlanta (Mercedes-Benz)', h:'1L', a:'3 E/H/I/J/K'},
    {id:'M82', stage:'r32', d:'2026-07-01', t:'16:00', v:'Seattle (Lumen Field)', h:'1G', a:'3 A/E/H/I/J'},
    {id:'M81', stage:'r32', d:'2026-07-01', t:'20:00', v:"San Francisco (Levi's)", h:'1D', a:'3 B/E/F/I/J'},
    {id:'M84', stage:'r32', d:'2026-07-02', t:'15:00', v:'Los Angeles (SoFi)', h:'1H', a:'2J'},
    {id:'M83', stage:'r32', d:'2026-07-02', t:'19:00', v:'Toronto (BMO Field)', h:'2K', a:'2L'},
    {id:'M85', stage:'r32', d:'2026-07-02', t:'23:00', v:'Vancouver (BC Place)', h:'1B', a:'3 E/F/G/I/J'},
    {id:'M88', stage:'r32', d:'2026-07-03', t:'14:00', v:'Dallas (AT&T)', h:'2D', a:'2G'},
    {id:'M86', stage:'r32', d:'2026-07-03', t:'18:00', v:'Miami (Hard Rock)', h:'1J', a:'2H'},
    {id:'M87', stage:'r32', d:'2026-07-03', t:'21:30', v:'Kansas City (Arrowhead)', h:'1K', a:'3 D/E/I/J/L'},
    {id:'M90', stage:'r16', d:'2026-07-04', t:'13:00', v:'Houston (NRG)', h:'W M73', a:'W M75'},
    {id:'M89', stage:'r16', d:'2026-07-04', t:'17:00', v:'Philadelphia (Lincoln Financial)', h:'W M74', a:'W M77'},
    {id:'M91', stage:'r16', d:'2026-07-05', t:'16:00', v:'New Jersey (MetLife)', h:'W M76', a:'W M78'},
    {id:'M92', stage:'r16', d:'2026-07-05', t:'20:00', v:'Mexico City (Azteca)', h:'W M79', a:'W M80'},
    {id:'M93', stage:'r16', d:'2026-07-06', t:'15:00', v:'Dallas (AT&T)', h:'W M83', a:'W M84'},
    {id:'M94', stage:'r16', d:'2026-07-06', t:'20:00', v:'Seattle (Lumen Field)', h:'W M81', a:'W M82'},
    {id:'M95', stage:'r16', d:'2026-07-07', t:'12:00', v:'Atlanta (Mercedes-Benz)', h:'W M86', a:'W M88'},
    {id:'M96', stage:'r16', d:'2026-07-07', t:'16:00', v:'Vancouver (BC Place)', h:'W M85', a:'W M87'},
    {id:'M97', stage:'qf', d:'2026-07-09', t:'16:00', v:'Boston (Gillette)', h:'W M89', a:'W M90'},
    {id:'M98', stage:'qf', d:'2026-07-10', t:'15:00', v:'Los Angeles (SoFi)', h:'W M93', a:'W M94'},
    {id:'M99', stage:'qf', d:'2026-07-11', t:'17:00', v:'Miami (Hard Rock)', h:'W M91', a:'W M92'},
    {id:'M100', stage:'qf', d:'2026-07-11', t:'21:00', v:'Kansas City (Arrowhead)', h:'W M95', a:'W M96'},
    {id:'M101', stage:'sf', d:'2026-07-14', t:'15:00', v:'Dallas (AT&T)', h:'W M97', a:'W M98'},
    {id:'M102', stage:'sf', d:'2026-07-15', t:'15:00', v:'Atlanta (Mercedes-Benz)', h:'W M99', a:'W M100'},
    {id:'M103', stage:'bronze', d:'2026-07-18', t:'17:00', v:'Miami (Hard Rock)', h:'L M101', a:'L M102'},
    {id:'M104', stage:'final', d:'2026-07-19', t:'15:00', v:'New Jersey (MetLife)', h:'W M101', a:'W M102'}
  ];

  var byId = {};
  var bySchedule = {};
  matches.forEach(function(match) {
    byId[match.id] = match;
    bySchedule[[match.d, match.t, match.v].join('|')] = match;
  });

  function recommendedMobileStage(completedMatchIds) {
    var completed = {};
    if (completedMatchIds && typeof completedMatchIds.forEach === 'function') {
      completedMatchIds.forEach(function(id) { completed[id] = true; });
    }
    var stages = ['r32', 'r16', 'qf'];
    for (var i = 0; i < stages.length; i++) {
      var stage = stages[i];
      var stageComplete = matches
        .filter(function(match) { return match.stage === stage; })
        .every(function(match) { return completed[match.id]; });
      if (!stageComplete) return stage;
    }
    return 'sf';
  }

  return {
    matches: matches,
    byId: byId,
    bySchedule: bySchedule,
    recommendedMobileStage: recommendedMobileStage,
    forStage: function(stage) {
      return matches.filter(function(match) { return match.stage === stage; });
    }
  };
});
