export const DEFAULT_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

// 判断本次触发是否需要采集；时间无效时允许采集，未来时间则避免立即重试。
export function shouldCollect({
  checkedAt,
  now = new Date(),
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
}) {
  if (!checkedAt) return true;

  const previousTime = new Date(checkedAt).getTime();
  if (!Number.isFinite(previousTime)) return true;

  return now.getTime() - previousTime >= minIntervalMs;
}
