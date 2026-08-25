function currentFrom(itineraries) {
  return {
    availability: itineraries.length > 0 ? 'available' : 'none',
    best_total_price: itineraries[0]?.total_price ?? null,
    currency: itineraries[0]?.currency ?? 'CNY',
    itineraries,
  };
}

function previousFullLastSuccess(previousLatest) {
  return previousLatest?.schema_version === 2
    && previousLatest?.collection_scope === 'full_itinerary'
    ? previousLatest.last_success ?? null
    : null;
}

// 生成完整行程 schema v2；旧起价历史保留，但不能成为 v2 的最近成功结果。
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
  const current = status === 'failed' ? null : currentFrom(collection.itineraries);
  const isFullSuccess = status === 'success' && collection.itineraries.length > 0;
  const lastSuccess = isFullSuccess
    ? { checked_at: checkedAt, ...current }
    : previousFullLastSuccess(previousLatest);
  const entry = {
    schema_version: 2,
    collection_scope: 'full_itinerary',
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
