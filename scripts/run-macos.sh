#!/bin/zsh
set -u

repo_dir="${FLIGHT_MONITOR_REPO_DIR:-/Users/sqlist/Library/Application Support/flight-monitor/repo}"
git_proxy="${FLIGHT_MONITOR_GIT_PROXY:-http://127.0.0.1:7890}"
export PATH="/Users/sqlist/.nvm/versions/node/v25.5.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# 为常驻任务输出带时区的简短日志。
log() {
  print -r -- "$(date '+%Y-%m-%d %H:%M:%S %z') $*"
}

# GitHub 代理偶发连接失败，远端操作最多重试三次。
remote_git() {
  local attempt
  for attempt in 1 2 3; do
    if git -c http.proxy="$git_proxy" "$@"; then
      return 0
    fi
    if (( attempt < 3 )); then
      log "GitHub operation failed; retrying ($attempt/3)"
      sleep 5
    fi
  done
  return 1
}

if [[ ! -d "$repo_dir/.git" ]]; then
  log "runtime repository is missing: $repo_dir"
  exit 1
fi

cd "$repo_dir" || exit 1

if ! remote_git pull --rebase origin main; then
  git rebase --abort >/dev/null 2>&1 || true
  log "could not sync GitHub; continuing with the local runtime copy"
fi

# 上一次推送失败时，本地提交仍然保留；先重试发布，再判断是否需要新采集。
if ! remote_git push origin HEAD:main; then
  log "an unpublished local commit is still waiting for GitHub"
fi

decision="$(node src/schedule-cli.js data/latest.json)" || exit 1
if [[ "$decision" == "skip" ]]; then
  log "collection skipped because the latest run is less than two hours old"
  exit 0
fi

log "starting visible Chromium collection"
FLIGHT_MONITOR_HEADLESS=false npm run collect
collect_status=$?

git config user.name "flight-monitor-mac"
git config user.email "flight-monitor-mac@users.noreply.github.com"
git add data/latest.json data/history.json

if ! git diff --cached --quiet; then
  git commit -m "data: record local ctrip collection" || exit 1
  if ! remote_git pull --rebase origin main; then
    git rebase --abort >/dev/null 2>&1 || true
    log "collection is committed locally but GitHub sync failed"
    exit 1
  fi
  if ! remote_git push origin HEAD:main; then
    log "collection is committed locally but GitHub push failed"
    exit 1
  fi
  log "collection data pushed to GitHub"
else
  log "collection produced no data changes"
fi

exit "$collect_status"
