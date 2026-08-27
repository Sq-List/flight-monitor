import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEligibleOutbound,
  isEligibleReturn,
  isEligibleConnection,
  rankItineraries,
  selectOutboundCandidates,
  validateCompleteItinerary,
} from '../src/itinerary.js';

function leg(overrides = {}) {
  return {
    date: '2026-10-01',
    airline: '南方航空',
    flight_no: 'CZ8416',
    departure_time: '19:20',
    departure_airport: '杭州萧山国际机场',
    arrival_time: '00:40+1',
    arrival_airport: '乌鲁木齐天山国际机场',
    direct: true,
    stops: [],
    ...overrides,
  };
}

function itinerary(overrides = {}) {
  return {
    total_price: 3830,
    price_text: '往返含税 ¥3830',
    price_scope: 'itinerary_starting_price',
    currency: 'CNY',
    outbound: leg(),
    return: leg({
      date: '2026-10-08',
      flight_no: 'CZ6979',
      departure_time: '09:35',
      departure_airport: '乌鲁木齐天山国际机场',
      arrival_time: '14:30',
      arrival_airport: '杭州萧山国际机场',
    }),
    ...overrides,
  };
}

test('applies outbound lower bounds without making arrival a hard limit', () => {
  assert.equal(isEligibleOutbound(leg({
    date: '2026-09-30',
    departure_time: '21:00',
    arrival_time: '03:00+1',
  })), true);
  assert.equal(isEligibleOutbound(leg({ date: '2026-09-30', departure_time: '20:59' })), false);
  assert.equal(isEligibleOutbound(leg({ departure_time: '15:00', arrival_time: '01:00+1' })), true);
  assert.equal(isEligibleOutbound(leg({ departure_time: '14:59' })), false);
  assert.equal(isEligibleOutbound(leg({ arrival_time: '03:00+1' })), true);
});

test('accepts return arrival at 18:00 and rejects 18:01', () => {
  assert.equal(isEligibleReturn(leg({ date: '2026-10-08', arrival_time: '18:00' })), true);
  assert.equal(isEligibleReturn(leg({ date: '2026-10-08', arrival_time: '18:01' })), false);
});

test('keeps a 45-minute connection and rejects a 46-minute connection', () => {
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 45 }] })), true);
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 46 }] })), false);
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: null }] })), false);
});

test('requires both legs and an explicit positive total price', () => {
  assert.equal(validateCompleteItinerary(itinerary()), true);
  assert.equal(validateCompleteItinerary(itinerary({ price_text: '加 ¥200' })), false);
  assert.equal(validateCompleteItinerary(itinerary({ price_scope: null })), false);
  assert.equal(validateCompleteItinerary(itinerary({ return: { ...itinerary().return, flight_no: null } })), false);
});

test('rejects a connection without a transfer airport', () => {
  const invalid = itinerary({
    outbound: leg({
      direct: false,
      stops: [{ airport: null, wait_minutes: 45 }],
    }),
  });
  assert.equal(validateCompleteItinerary(invalid), false);
});

test('sorts direct and connecting itineraries together by total price', () => {
  const connecting = itinerary({
    total_price: 3500,
    price_text: '往返含税 ¥3500',
    outbound: leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 45 }] }),
  });
  const direct = itinerary({ total_price: 3600, price_text: '往返含税 ¥3600' });
  assert.deepEqual(rankItineraries([direct, connecting]).map((item) => item.total_price), [3500, 3600]);
});

test('breaks equal-price ties by outbound target time and then earlier return arrival', () => {
  const laterReturn = itinerary({ return: leg({
    date: '2026-10-08',
    flight_no: 'CZ6979',
    departure_time: '10:00',
    departure_airport: '乌鲁木齐天山国际机场',
    arrival_time: '16:00',
    arrival_airport: '杭州萧山国际机场',
  }) });
  const preferred = itinerary({
    outbound: leg({ departure_time: '18:00' }),
    return: leg({
      date: '2026-10-08',
      flight_no: 'GJ8968',
      departure_time: '07:30',
      departure_airport: '乌鲁木齐天山国际机场',
      arrival_time: '12:30',
      arrival_airport: '杭州萧山国际机场',
    }),
  });
  assert.equal(rankItineraries([laterReturn, preferred])[0].return.flight_no, 'GJ8968');
});

test('selects at most five eligible outbounds by starting price', () => {
  const values = [4200, 3500, 3900, 3600, 3700, 3800, 3400].map(
    (price, index) => leg({
      flight_no: `AB12${index}0`,
      departure_time: index === 0 ? '14:00' : '18:00',
      price: { total_price: price },
    }),
  );
  assert.deepEqual(
    selectOutboundCandidates(values).map((item) => item.price.total_price),
    [3400, 3500, 3600, 3700, 3800],
  );
});

test('selects five direct and five connecting outbounds', () => {
  const direct = [3700, 3500, 3900, 3400, 3800, 3600, 4000].map(
    (price, index) => leg({
      flight_no: `D${index}100`,
      direct: true,
      stops: [],
      price: { total_price: price },
    }),
  );
  const connecting = [4100, 3300, 3700, 3500, 3900, 3400, 3600].map(
    (price, index) => leg({
      flight_no: `C${index}100`,
      direct: false,
      stops: [{ airport: '中转机场', wait_minutes: 45 }],
      price: { total_price: price },
    }),
  );

  const selected = selectOutboundCandidates([...direct, ...connecting]);

  assert.equal(selected.filter((item) => item.direct).length, 5);
  assert.equal(selected.filter((item) => !item.direct).length, 5);
  assert.deepEqual(
    selected.filter((item) => item.direct).map((item) => item.price.total_price),
    [3400, 3500, 3600, 3700, 3800],
  );
  assert.deepEqual(
    selected.filter((item) => !item.direct).map((item) => item.price.total_price),
    [3300, 3400, 3500, 3600, 3700],
  );
});

test('prioritizes October 1 arrivals by next-day 01:00 and fills remaining slots', () => {
  const values = [
    leg({ flight_no: 'EARLY1', arrival_time: '00:20+1', price: { total_price: 3900 } }),
    leg({ flight_no: 'EARLY2', arrival_time: '00:40+1', price: { total_price: 3800 } }),
    leg({ flight_no: 'EARLY3', arrival_time: '01:00+1', price: { total_price: 4000 } }),
    leg({ flight_no: 'EARLY4', arrival_time: '23:50', price: { total_price: 3700 } }),
    leg({ flight_no: 'LATE1', arrival_time: '01:10+1', price: { total_price: 3300 } }),
    leg({ flight_no: 'LATE2', arrival_time: '02:00+1', price: { total_price: 3400 } }),
  ];

  assert.deepEqual(
    selectOutboundCandidates(values).map((item) => item.flight_no),
    ['EARLY4', 'EARLY2', 'EARLY1', 'EARLY3', 'LATE1'],
  );
});
