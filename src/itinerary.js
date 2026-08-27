const OUTBOUND_WINDOWS = {
  '2026-09-30': { depart: '21:00', preferred: '22:00' },
  '2026-10-01': {
    depart: '15:00',
    preferred: '18:00',
    softArrival: '01:00+1',
  },
};

const EXPLICIT_TOTAL_RE = /往返(?:含税)?|往返总价|含税总价/;
const REQUIRED_LEG_FIELDS = [
  'date',
  'airline',
  'flight_no',
  'departure_time',
  'departure_airport',
  'arrival_time',
  'arrival_airport',
];

function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})(\+1)?$/.exec(String(value ?? ''));
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]) + (match[3] ? 1440 : 0);
}

// 直飞直接通过；中转必须给出每一段等待时间，45 分钟也属于有效边界。
export function isEligibleConnection(leg) {
  if (leg?.direct === true) return true;
  return Array.isArray(leg?.stops)
    && leg.stops.length > 0
    && leg.stops.every((stop) => Number.isInteger(stop.wait_minutes)
      && stop.wait_minutes >= 0
      && stop.wait_minutes <= 45);
}

// 去程到达时间不做硬过滤；10 月 1 日的到达软限制只在候选排序中使用。
export function isEligibleOutbound(leg) {
  const window = OUTBOUND_WINDOWS[leg?.date];
  if (!window || !isEligibleConnection(leg)) return false;
  const departure = clockMinutes(leg.departure_time);
  const arrival = clockMinutes(leg.arrival_time);
  return Number.isFinite(departure)
    && Number.isFinite(arrival)
    && departure >= clockMinutes(window.depart);
}

// 返程出发时间不限，但必须在 10 月 8 日 18:00 及以前抵达杭州。
export function isEligibleReturn(leg) {
  return leg?.date === '2026-10-08'
    && isEligibleConnection(leg)
    && clockMinutes(leg.arrival_time) <= clockMinutes('18:00');
}

function completeLeg(leg) {
  return REQUIRED_LEG_FIELDS.every(
    (field) => typeof leg?.[field] === 'string' && leg[field],
  )
    && typeof leg?.direct === 'boolean'
    && Array.isArray(leg?.stops)
    && (leg.direct || leg.stops.every(
      (stop) => typeof stop.airport === 'string' && stop.airport,
    ));
}

// 只有双方航班字段齐全、时间满足要求且价格明确为往返总价时才接收组合。
export function validateCompleteItinerary(value) {
  return Number.isFinite(value?.total_price)
    && value.total_price > 0
    && value.currency === 'CNY'
    && value.price_scope === 'itinerary_starting_price'
    && typeof value.price_text === 'string'
    && EXPLICIT_TOTAL_RE.test(value.price_text)
    && completeLeg(value.outbound)
    && completeLeg(value.return)
    && isEligibleOutbound(value.outbound)
    && isEligibleReturn(value.return);
}

function outboundPreferredDistance(leg) {
  const preferred = OUTBOUND_WINDOWS[leg.date].preferred;
  return Math.abs(clockMinutes(leg.departure_time) - clockMinutes(preferred));
}

// 软限制只决定深入检查去程的先后，不影响完整往返组合最终按价格排名。
function outboundArrivalPriority(leg) {
  const softArrival = OUTBOUND_WINDOWS[leg.date]?.softArrival;
  return softArrival && clockMinutes(leg.arrival_time) > clockMinutes(softArrival)
    ? 1
    : 0;
}

function preferredDistance(item) {
  return outboundPreferredDistance(item.outbound);
}

function compareOutboundCandidates(left, right) {
  return outboundArrivalPriority(left) - outboundArrivalPriority(right)
    || (left.price?.total_price ?? Number.POSITIVE_INFINITY)
      - (right.price?.total_price ?? Number.POSITIVE_INFINITY)
    || outboundPreferredDistance(left) - outboundPreferredDistance(right)
    || left.flight_no.localeCompare(right.flight_no);
}

// 去程页分别深入检查最多五个直飞和五个中转候选，兼顾两种出行方式。
export function selectOutboundCandidates(values, limitPerType = 5) {
  const sorted = values
    .filter(isEligibleOutbound)
    .sort(compareOutboundCandidates);
  return [true, false]
    .flatMap((direct) => sorted
      .filter((item) => item.direct === direct)
      .slice(0, limitPerType))
    .sort(compareOutboundCandidates);
}

// 直飞和中转统一按总价排序；同价时再比较去程匹配度和返程到达时间。
export function rankItineraries(values) {
  return values
    .filter(validateCompleteItinerary)
    .sort((left, right) => left.total_price - right.total_price
      || preferredDistance(left) - preferredDistance(right)
      || clockMinutes(left.return.arrival_time) - clockMinutes(right.return.arrival_time)
      || left.outbound.flight_no.localeCompare(right.outbound.flight_no)
      || left.return.flight_no.localeCompare(right.return.flight_no))
    .map((item, index) => ({ rank: index + 1, ...item }));
}
