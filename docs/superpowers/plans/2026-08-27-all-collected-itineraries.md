# All Collected Itineraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select up to five direct and five connecting outbounds, then persist every valid complete round-trip combination collected from them.

**Architecture:** Reuse the existing outbound comparator but apply its quota separately to direct and connecting groups, then merge the selected candidates back into the same deterministic order. Remove only the final itinerary truncation; the existing state builder will write the complete ranked list into latest, last_success, and history without a schema change.

**Tech Stack:** Node.js, Playwright collector, Node test runner, JSON state files

---

### Task 1: Select five outbounds per flight type

**Files:**
- Modify: `tests/itinerary.test.js`
- Modify: `src/itinerary.js:80-108`

- [ ] **Step 1: Write the failing mixed-type quota test**

Add a test containing seven eligible direct and seven eligible connecting legs. Assert that selection returns exactly five of each type and that each group keeps the lowest five starting prices.

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/itinerary.test.js`

Expected: FAIL because the current selector returns only five candidates total.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/itinerary.test.js
git commit -m "test(collector): cover outbound type quotas"
```

- [ ] **Step 4: Extract the existing comparator and apply per-type quotas**

Use one comparator for both groups and the merged output:

```js
function compareOutboundCandidates(left, right) {
  return outboundArrivalPriority(left) - outboundArrivalPriority(right)
    || (left.price?.total_price ?? Number.POSITIVE_INFINITY)
      - (right.price?.total_price ?? Number.POSITIVE_INFINITY)
    || outboundPreferredDistance(left) - outboundPreferredDistance(right)
    || left.flight_no.localeCompare(right.flight_no);
}

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
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/itinerary.test.js`

Expected: all itinerary tests pass, including existing soft-arrival and five-per-group behavior.

- [ ] **Step 6: Commit the selector implementation**

```bash
git add src/itinerary.js
git commit -m "feat(collector): select outbounds by flight type"
```

### Task 2: Preserve every valid ranked combination

**Files:**
- Modify: `tests/itinerary.test.js`
- Modify: `tests/state.test.js`
- Modify: `src/itinerary.js:110-120`

- [ ] **Step 1: Write the failing no-truncation ranking test**

```js
test('ranks every valid itinerary without truncation', () => {
  const values = [3700, 3500, 3900, 3400, 3800, 3600, 4000].map(
    (totalPrice, index) => itinerary({
      total_price: totalPrice,
      price_text: `往返总价 ¥${totalPrice}`,
      return: leg({
        date: '2026-10-08',
        flight_no: `R${index}100`,
        departure_time: '08:00',
        departure_airport: '乌鲁木齐天山国际机场',
        arrival_time: '13:00',
        arrival_airport: '杭州萧山国际机场',
      }),
    }),
  );

  const ranked = rankItineraries(values);

  assert.deepEqual(ranked.map((item) => item.total_price), [
    3400, 3500, 3600, 3700, 3800, 3900, 4000,
  ]);
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/itinerary.test.js`

Expected: FAIL because `rankItineraries` currently slices the list to five.

- [ ] **Step 3: Commit the failing ranking test**

```bash
git add tests/itinerary.test.js
git commit -m "test(data): cover complete itinerary ranking"
```

- [ ] **Step 4: Remove the ranking limit**

Change `rankItineraries` to filter, sort, and rank the full valid list:

```js
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
```

- [ ] **Step 5: Add a state assertion for the full list**

Extend the existing successful-state test to pass seven ranked complete itineraries:

```js
const allItineraries = Array.from({ length: 7 }, (_, index) => ({
  ...complete,
  rank: index + 1,
  total_price: 3500 + index,
  price_text: `往返含税 ¥${3500 + index}`,
}));

// In the test's collection value:
itineraries: allItineraries,

assert.equal(next.latest.current.itineraries.length, 7);
assert.equal(next.latest.last_success.itineraries.length, 7);
assert.equal(next.history[1].current.itineraries.length, 7);
```

This assertion documents existing state behavior; no state implementation change is expected.

- [ ] **Step 6: Run focused and full validation**

Run:

```bash
node --test tests/itinerary.test.js tests/state.test.js
npm test
node --check src/itinerary.js
git diff --check
```

Expected: all tests and checks pass.

- [ ] **Step 7: Commit implementation and state coverage**

```bash
git add src/itinerary.js tests/state.test.js
git commit -m "feat(data): persist all collected itineraries"
```

### Task 3: Publish and deploy the collector change

**Files:**
- Repository: `/Users/sqlist/Project/other/flight-monitor`

- [ ] **Step 1: Verify the scheduled task is idle**

Inspect `com.sqlist.flight-monitor` and the dedicated Chromium profile process before publishing.

Expected: no collection or dedicated browser process is running.

- [ ] **Step 2: Rebase and publish tested code**

Verify GitHub connectivity through the configured proxy, fetch `origin/main`, rebase local `main`, rerun `npm test`, and push without force.

Expected: GitHub `main` and the single local repository point to the full-persistence implementation commit.

### Task 4: Run and validate a real collection

**Files:**
- Modify: `data/latest.json`
- Modify: `data/history.json`

- [ ] **Step 1: Run a visible background collection**

Run: `FLIGHT_MONITOR_HEADLESS=false npm run collect`

Expected: the log selects up to five direct and five connecting outbounds, completes both dates, and exits with code 0.

- [ ] **Step 2: Match logs to JSON**

Capture the final `累计组合 N` value and assert:

```text
data/latest.json status is success
current.itineraries.length equals N
last_success.itineraries.length equals N
the last history entry current.itineraries.length equals N
N is greater than 5
```

- [ ] **Step 3: Validate every saved combination**

Check every itinerary has continuous `rank`, a positive `total_price`, and complete outbound and return legs. Confirm all rows satisfy the existing departure, arrival, and connection rules.

- [ ] **Step 4: Validate browser cleanup**

Confirm the dedicated Chromium process is absent and `DevToolsActivePort` does not exist.

- [ ] **Step 5: Commit and push collection data**

```bash
git add data/latest.json data/history.json
git commit -m "data: record full local ctrip collection"
git push origin main
```

Expected: only the two data files are included in the collection commit.

### Task 5: Final verification

**Files:**
- Repository: `/Users/sqlist/Project/other/flight-monitor`

- [ ] **Step 1: Run final checks**

Run:

```bash
npm test
node --check src/itinerary.js
git diff --check
git status --short
```

Expected: all checks pass and the working tree is clean.

- [ ] **Step 2: Verify GitHub alignment and launchd**

Confirm `HEAD`, `origin/main`, and GitHub `main` are identical. Confirm launchd remains loaded from `/Users/sqlist/Project/other/flight-monitor` with its previous schedule.
