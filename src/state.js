function currentFrom(flights) {
  return {
    availability: flights.length > 0 ? 'available' : 'none',
    best_price: flights[0]?.price ?? null,
    currency: flights[0]?.currency ?? 'CNY',
    flights,
  };
}

function previousReturnLastSuccess(previousLatest) {
  return previousLatest?.schema_version === 3
    && previousLatest?.collection_scope === 'return_one_way'
    ? previousLatest.last_success ?? null
    : null;
}

// 生成返程单程 schema v3；旧往返历史保留，但不能成为新口径的最近成功结果。
export function buildNextState({
  previousLatest,
  history,
  queries,
  checkedAt,
  collection,
}) {
  const completed = collection.scans.filter(
    (scan) => scan.status === 'completed',
  ).length;
  const status = completed === queries.length
    ? 'success'
    : completed > 0
      ? 'partial'
      : 'failed';
  const current = status === 'failed' ? null : currentFrom(collection.flights);
  const isFullSuccess = status === 'success' && collection.flights.length > 0;
  const lastSuccess = isFullSuccess
    ? { checked_at: checkedAt, ...current }
    : previousReturnLastSuccess(previousLatest);
  const entry = {
    schema_version: 3,
    collection_scope: 'return_one_way',
    status,
    checked_at: checkedAt,
    queries,
    scans: collection.scans,
    current,
    errors: collection.errors,
  };

  return {
    latest: { ...entry, last_success: lastSuccess },
    history: [...history, entry],
  };
}
