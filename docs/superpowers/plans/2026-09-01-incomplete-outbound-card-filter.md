# Incomplete Outbound Card Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter incomplete outbound cards before candidate sorting so a missing flight number cannot abort collection.

**Architecture:** Reuse the existing complete-leg validation inside `isEligibleOutbound`, which is already the single gate used before candidate sorting and by final itinerary validation. Keep the comparator strict; invalid cards disappear before it runs instead of being converted into sortable placeholder strings.

**Tech Stack:** Node.js ES modules, Playwright, built-in `node:test` and `assert`.

---

### Task 1: Reproduce incomplete outbound filtering

**Files:**
- Modify: `tests/itinerary.test.js`
- Test: `tests/itinerary.test.js`

- [ ] **Step 1: Write the failing regression test**

Add this test beside the existing outbound-selection tests:

```js
test('filters incomplete outbounds before candidate sorting', () => {
  const complete = leg({
    flight_no: 'CZ8416',
    price: { total_price: 3500 },
  });
  const incomplete = leg({
    flight_no: null,
    price: { total_price: 3500 },
  });

  assert.equal(isEligibleOutbound(incomplete), false);
  assert.deepEqual(
    selectOutboundCandidates([incomplete, complete]).map((item) => item.flight_no),
    ['CZ8416'],
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='filters incomplete outbounds' tests/itinerary.test.js
```

Expected: FAIL because `isEligibleOutbound(incomplete)` currently returns `true`; candidate sorting may also reproduce `Cannot read properties of null (reading 'localeCompare')`.

- [ ] **Step 3: Commit the regression test**

```bash
git add tests/itinerary.test.js
git commit -m "test(collector): cover incomplete outbound cards"
```

### Task 2: Filter incomplete cards at the eligibility boundary

**Files:**
- Modify: `src/itinerary.js:36-46`
- Test: `tests/itinerary.test.js`

- [ ] **Step 1: Require a complete leg in `isEligibleOutbound`**

Change the initial guard to:

```js
export function isEligibleOutbound(leg) {
  const window = OUTBOUND_WINDOWS[leg?.date];
  if (!window || !completeLeg(leg) || !isEligibleConnection(leg)) return false;
  const departure = clockMinutes(leg.departure_time);
  const arrival = clockMinutes(leg.arrival_time);
  return Number.isFinite(departure)
    && Number.isFinite(arrival)
    && departure >= clockMinutes(window.depart);
}
```

`completeLeg` is a function declaration and is therefore available before its textual definition. Do not make the comparator null-safe and do not change the DOM selector, quotas, timing, or price rules.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
node --test --test-name-pattern='filters incomplete outbounds' tests/itinerary.test.js
```

Expected: PASS; the incomplete card is excluded and the complete card remains selected.

- [ ] **Step 3: Run the itinerary test file**

Run:

```bash
node --test tests/itinerary.test.js
```

Expected: all itinerary tests pass, including date windows, 45-minute connections, direct/connecting quotas, and full ranking.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/itinerary.js
git commit -m "fix(collector): filter incomplete outbound cards"
```

### Task 3: Verify the complete collector and live behavior

**Files:**
- Verify: `src/itinerary.js`
- Verify: `src/collector.js`
- Verify: `data/latest.json`
- Verify: `data/history.json`

- [ ] **Step 1: Run the full automated checks**

Run:

```bash
npm test
node --check src/itinerary.js
node --check src/collector.js
git diff --check
```

Expected: all tests and syntax checks pass with no diff errors.

- [ ] **Step 2: Run one real visible-background collection**

Run:

```bash
FLIGHT_MONITOR_HEADLESS=false npm run collect
```

Expected: the collection reaches outbound candidate logging without `null.localeCompare`; Chromium closes when the run finishes.

- [ ] **Step 3: Validate the resulting JSON**

Run:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { validateCompleteItinerary } from './src/itinerary.js';

const latest = JSON.parse(fs.readFileSync('data/latest.json', 'utf8'));
const history = JSON.parse(fs.readFileSync('data/history.json', 'utf8'));
const current = latest.current?.itineraries ?? [];
const historyCurrent = history.at(-1)?.current?.itineraries ?? [];

if (historyCurrent.length !== current.length) throw new Error('history count mismatch');
if (!current.every(validateCompleteItinerary)) throw new Error('invalid itinerary');
if (!current.every((item, index) => item.rank === index + 1)) {
  throw new Error('non-continuous ranks');
}
if (!current.every((item, index) => index === 0
  || current[index - 1].total_price <= item.total_price)) {
  throw new Error('prices not sorted');
}

console.log(`validated ${current.length} itineraries`);
NODE
```

Expected: JSON parses successfully; logged and persisted complete-combination counts agree. If Ctrip independently returns login, captcha, or network errors, report that external failure separately rather than treating it as a regression of this fix.

- [ ] **Step 4: Commit successful real collection data when files changed**

```bash
git add data/latest.json data/history.json
git commit -m "data: record local ctrip collection"
```

Do not push without a separate explicit user request.
