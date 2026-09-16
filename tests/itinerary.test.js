import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEligibleReturnFlight,
  rankReturnFlights,
  validateReturnFlight,
} from '../src/itinerary.js';

function flight(overrides = {}) {
  return {
    date: '2026-10-08',
    airline: '长龙航空',
    flight_no: 'GJ8968',
    departure_time: '07:30',
    departure_airport: '乌鲁木齐天山国际机场T3',
    arrival_time: '12:30',
    arrival_airport: '杭州萧山国际机场T3',
    service_type: 'direct',
    stops: [],
    price: 1880,
    price_text: '¥1880起',
    price_scope: 'flight_starting_price',
    currency: 'CNY',
    ...overrides,
  };
}

test('accepts return arrival at 18:00 and rejects 18:01', () => {
  assert.equal(isEligibleReturnFlight(flight({ arrival_time: '18:00' })), true);
  assert.equal(isEligibleReturnFlight(flight({ arrival_time: '18:01' })), false);
  assert.equal(isEligibleReturnFlight(flight({ date: '2026-10-07' })), false);
});

test('keeps direct, stopover and through flights but rejects transfers', () => {
  assert.equal(isEligibleReturnFlight(flight()), true);
  assert.equal(isEligibleReturnFlight(flight({
    service_type: 'stopover',
    stops: [{ airport: '西安咸阳国际机场', wait_minutes: 120 }],
  })), true);
  assert.equal(isEligibleReturnFlight(flight({
    service_type: 'through',
    stops: [{ airport: null, wait_minutes: null }],
  })), true);
  assert.equal(isEligibleReturnFlight(flight({
    service_type: 'transfer',
    stops: [{ airport: '西安咸阳国际机场', wait_minutes: 60 }],
  })), false);
});

test('rejects a displayed stop duration longer than two hours', () => {
  assert.equal(isEligibleReturnFlight(flight({
    service_type: 'stopover',
    stops: [{ airport: '西安咸阳国际机场', wait_minutes: 121 }],
  })), false);
  assert.equal(isEligibleReturnFlight(flight({
    service_type: 'stopover',
    stops: [{ airport: '西安咸阳国际机场', wait_minutes: null }],
  })), true);
});

test('requires complete flight fields and an explicit positive one-way price', () => {
  assert.equal(validateReturnFlight(flight()), true);
  assert.equal(validateReturnFlight(flight({ flight_no: null })), false);
  assert.equal(validateReturnFlight(flight({ price: 0 })), false);
  assert.equal(validateReturnFlight(flight({ price_scope: 'itinerary_starting_price' })), false);
  assert.equal(validateReturnFlight(flight({ currency: 'USD' })), false);
});

test('sorts every valid return flight by price', () => {
  const values = [2100, 1880, 1990, 2300, 1950, 2050, 2150].map(
    (price, index) => flight({
      flight_no: `AB12${index}0`,
      price,
      price_text: `¥${price}起`,
    }),
  );

  const ranked = rankReturnFlights(values);

  assert.deepEqual(ranked.map((item) => item.price), [
    1880, 1950, 1990, 2050, 2100, 2150, 2300,
  ]);
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7]);
});

test('breaks equal-price ties by arrival and departure time', () => {
  const laterArrival = flight({
    flight_no: 'AB1234',
    departure_time: '08:00',
    arrival_time: '15:00',
  });
  const earlierArrival = flight({
    flight_no: 'AB1235',
    departure_time: '09:00',
    arrival_time: '14:00',
  });

  assert.equal(
    rankReturnFlights([laterArrival, earlierArrival])[0].flight_no,
    'AB1235',
  );
});
