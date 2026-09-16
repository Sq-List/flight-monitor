const REQUIRED_FLIGHT_FIELDS = [
  'date',
  'airline',
  'flight_no',
  'departure_time',
  'departure_airport',
  'arrival_time',
  'arrival_airport',
  'service_type',
];

const ALLOWED_SERVICE_TYPES = new Set(['direct', 'stopover', 'through']);

function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})(\+1)?$/.exec(String(value ?? ''));
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]) + (match[3] ? 1440 : 0);
}

function hasCompleteFields(flight) {
  return REQUIRED_FLIGHT_FIELDS.every(
    (field) => typeof flight?.[field] === 'string' && flight[field],
  )
    && Array.isArray(flight?.stops);
}

// 只保留直飞、经停和通程；已展示的停留时间不能超过两小时。
function isEligibleService(flight) {
  return ALLOWED_SERVICE_TYPES.has(flight?.service_type)
    && flight.stops.every((stop) => stop.wait_minutes === null
      || (Number.isInteger(stop.wait_minutes)
        && stop.wait_minutes >= 0
        && stop.wait_minutes <= 120));
}

// 只监测 10 月 8 日返杭、18:00 及以前抵达的完整航班。
export function isEligibleReturnFlight(flight) {
  return flight?.date === '2026-10-08'
    && hasCompleteFields(flight)
    && isEligibleService(flight)
    && clockMinutes(flight.arrival_time) <= clockMinutes('18:00');
}

// 单程报价必须是携程航班卡片的人民币起价，不能混入旧往返组合价格。
export function validateReturnFlight(flight) {
  return isEligibleReturnFlight(flight)
    && Number.isFinite(flight.price)
    && flight.price > 0
    && flight.currency === 'CNY'
    && flight.price_scope === 'flight_starting_price'
    && typeof flight.price_text === 'string'
    && flight.price_text.includes('¥');
}

// 所有合格返程统一按单程起价排序，同价时优先更早抵达。
export function rankReturnFlights(values) {
  return values
    .filter(validateReturnFlight)
    .sort((left, right) => left.price - right.price
      || clockMinutes(left.arrival_time) - clockMinutes(right.arrival_time)
      || clockMinutes(left.departure_time) - clockMinutes(right.departure_time)
      || left.flight_no.localeCompare(right.flight_no))
    .map((item, index) => ({ rank: index + 1, ...item }));
}
