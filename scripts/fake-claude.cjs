// Fake Claude Messages API for local UI testing (no network, no cost).
// Run: node scripts/fake-claude.cjs, then set ANTHROPIC_API_KEY=sk-fake and ANTHROPIC_BASE_URL=http://127.0.0.1:8788 in .dev.vars.
const http = require('http');
const reply = (res, obj) => {
  const body = JSON.stringify({
    id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    usage: { input_tokens: 2500, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fake' });
  res.end(body);
};
const f = (value, evidence = value) => ({ value, evidence });
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const sys = String(body.system || '');
    if (sys.startsWith('You read photos of coffee packaging')) {
      return reply(res, {
        name: f('Lazzio Brazil Single Origin'), brand: f('Lazzio', 'LAZZIO'), product: f('Brazil Single Origin'), origin_country: f('Brazil'),
        region: f('Minas Gerais'), farm: f(null), variety: f(null), processing: f(null),
        roast_level: { value: 'medium', evidence: 'MEDIUM ROAST' }, roast_date: { value: null, evidence: 'BEST BEFORE 12/2027' },
        altitude: f(null), intensity: f('4/5', 'INTENSITY ●●●●○'), cupping_score: { value: null, evidence: null },
        tasting_notes: ['Toffee', 'bittersweet cocoa', 'milk chocolate'],
        packaging_recipe: { dose_g: 20, yield_g: 40, stated_ratio: 2.25, time_s: 28, temperature_c: null },
        raw_text: 'LAZZIO\nBRAZIL SINGLE ORIGIN\nMINAS GERAIS\nMEDIUM ROAST\nToffee · Bittersweet cocoa · Milk chocolate\nESPRESSO 1:2.25 — 20g in, 40g out, 28s\nBEST BEFORE 12/2027',
        uncertainties: ['Only a best-before date is printed, so the roast date is unknown.'],
      });
    }
    if (sys.startsWith('You describe a photo of roasted coffee beans')) {
      return reply(res, { roast_estimate: 'medium', roast_estimate_note: 'Medium, possibly medium-dark in places', colour_consistency: 'Mostly even with a few lighter beans', surface: 'Mostly dry, a few beans with a slight sheen', oiliness: 'slight sheen', defects: ['One or two broken beans'], general: 'Clean, evenly roasted batch', confidence: 'medium' });
    }
    if (sys.includes('proposed a starting recipe')) {
      return reply(res, { dose_g: 20, yield_g: 40, temperature_c: 93, time_min_s: 27, time_max_s: 30, preinfusion_min_s: 5, preinfusion_max_s: 8, rationale: 'Chocolate and toffee from the bag: keep 1:2 at 93 °C for body; a slightly shorter window suits this medium roast.' });
    }
    if (sys.includes('proposes one adjustment')) {
      const ctx = JSON.parse(body.messages[0].content[0].text.split('\n\nReturn')[0]);
      const b = ctx.baseline_for_next_shot;
      return reply(res, { adjustment: 'increase_yield', diagnosis: 'balance', headline: `Increase yield to ${b.yield_g + 2} g`, explanation: 'You said it was sweet but sharp at the finish: a little more yield should round it off without changing the grind.', checks: ['Keep the same grind and temperature.'], promising: false, next: { ...b, yield_g: b.yield_g + 2 } });
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'unknown fake task' } }));
  });
}).listen(8788, '127.0.0.1', () => console.log('fake claude on 8788'));
