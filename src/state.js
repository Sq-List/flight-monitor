function successfulCurrent(quotes) {
  const best = quotes.reduce((lowest, quote) =>
    quote.price < lowest.price ? quote : lowest,
  );

  return {
    best_price: best.price,
    currency: best.currency,
    quotes,
  };
}

// 根据本次采集结果生成最新状态，并将本次运行追加到完整历史中。
export function buildNextState({
  previousLatest,
  history,
  query,
  checkedAt,
  quotes = null,
  error = null,
}) {
  const success = Array.isArray(quotes) && quotes.length > 0 && error === null;
  const current = success ? successfulCurrent(quotes) : null;
  const lastSuccess = success
    ? { checked_at: checkedAt, ...current }
    : previousLatest?.last_success ?? null;
  const normalizedError = success ? null : error;

  const latest = {
    schema_version: 1,
    status: success ? 'success' : 'failed',
    checked_at: checkedAt,
    query,
    current,
    last_success: lastSuccess,
    error: normalizedError,
  };
  const historyEntry = {
    checked_at: checkedAt,
    status: latest.status,
    query,
    current,
    error: normalizedError,
  };

  return {
    latest,
    history: [...history, historyEntry],
  };
}
