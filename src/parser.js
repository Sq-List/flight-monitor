const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const FLIGHT_NO_RE = /^[A-Z0-9]{2}\d{3,4}[A-Z]?$/;
const PRICE_RE = /^\d+(?:[.,]\d+)?$/;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function currencyCode(symbol) {
  return { '¥': 'CNY', '$': 'USD', '€': 'EUR', '£': 'GBP' }[symbol] ?? null;
}

function parseCard(rawChunks, sourceUrl) {
  const chunks = rawChunks.map(clean).filter(Boolean);
  const firstTimeIndex = chunks.findIndex((chunk) => TIME_RE.test(chunk));
  if (firstTimeIndex < 1) return null;

  const arrivalTimeIndex = chunks.findIndex(
    (chunk, index) => index > firstTimeIndex && TIME_RE.test(chunk),
  );
  if (arrivalTimeIndex < 0) return null;

  let flightNo = null;
  let aircraft = null;
  for (const chunk of chunks.slice(1, firstTimeIndex)) {
    if (flightNo === null && FLIGHT_NO_RE.test(chunk)) flightNo = chunk;
    else if (aircraft === null && !FLIGHT_NO_RE.test(chunk)) aircraft = chunk;
  }

  let price = null;
  let currency = null;
  for (let index = 0; index < chunks.length - 1; index += 1) {
    const code = currencyCode(chunks[index]);
    if (code && PRICE_RE.test(chunks[index + 1])) {
      price = Number(chunks[index + 1].replace(',', ''));
      currency = code;
      break;
    }
  }

  const departureAirport = chunks[firstTimeIndex + 1] ?? null;
  const arrivalAirport = chunks[arrivalTimeIndex + 1] ?? null;
  if (!chunks[0] || !departureAirport || !arrivalAirport || !(price > 0)) return null;

  return {
    airline: chunks[0],
    flight_no: flightNo,
    aircraft,
    departure_time: chunks[firstTimeIndex],
    departure_airport: departureAirport,
    arrival_time: chunks[arrivalTimeIndex],
    arrival_airport: arrivalAirport,
    terminal: /^T\d$/.test(chunks[arrivalTimeIndex + 2] ?? '')
      ? chunks[arrivalTimeIndex + 2]
      : null,
    price,
    currency,
    cabin: [...chunks].reverse().find((chunk) => /舱$/.test(chunk)) ?? null,
    source_url: sourceUrl,
  };
}

// 将携程渲染卡片的有序文本转换为稳定报价结构，并过滤不完整卡片。
export function parseFlightCards(cards, sourceUrl) {
  return cards
    .map((chunks) => parseCard(chunks, sourceUrl))
    .filter(Boolean)
    .map((quote, index) => ({ rank: index + 1, ...quote }));
}
