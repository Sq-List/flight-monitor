# Return-only Flight Monitor Implementation Plan

> **Execution:** Implement the authorized tasks and run their required checks. Choose direct execution or authorized delegation according to the task. Skill references do not authorize commits, pushes, or worktree creation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor only the 2026-10-08 Urumqi-to-Hangzhou one-way return flight and persist every eligible single-flight starting price.

**Architecture:** Replace the two-step round-trip page flow with one Ctrip one-way query and a single card extraction pass. Persist a schema v3 `return_one_way` snapshot so historical round-trip schema v1/v2 entries remain intact but cannot be compared with the new one-way prices.

**Tech Stack:** Node.js 22+, Playwright, node:test, JSON state files, macOS launchd.

---

### Task 1: One-way flight rules

**Files:**
- Modify: `src/itinerary.js`
- Modify: `tests/itinerary.test.js`

- [x] **Step 1: Replace round-trip validation tests with return-flight tests**

Cover complete flight fields, arrival at `18:00`, rejection at `18:01`, accepted `direct`/`stopover`/`through` service types, rejected `transfer` service type, stop durations at 120 and 121 minutes, explicit one-way price scope, full price ordering, and tie-breaking by arrival time.

- [ ] **Step 2: Run the focused test and verify the old implementation fails**

Run: `node --test tests/itinerary.test.js`

Expected: FAIL because the one-way validation and ranking exports do not exist.

- [x] **Step 3: Implement the one-way rules**

Export `isEligibleReturnFlight`, `validateReturnFlight`, and `rankReturnFlights`. Accept only `direct`, `stopover`, and `through`; reject `transfer`. When a stop duration is present it must be from 0 through 120 minutes. A valid flight must be dated `2026-10-08`, arrive no later than `18:00`, and have a positive CNY `flight_starting_price`.

- [x] **Step 4: Run the focused test**

Run: `node --test tests/itinerary.test.js`

Expected: PASS.

### Task 2: One-way Ctrip page flow and collector

**Files:**
- Modify: `src/ctrip-page.js`
- Modify: `src/collector.js`
- Modify: `src/cli.js`
- Modify: `tests/ctrip-page.test.js`
- Modify: `tests/collector.test.js`
- Modify: `tests/fixtures/ctrip-oneway-cards.html`

- [x] **Step 1: Update tests for a one-way URL and card price**

Assert the URL is `oneway-urc-hgh` with `depdate=2026-10-08`, accept `¥1,880起` as `flight_starting_price`, reject deltas such as `加 ¥200`, and call `session.listFlights(query)` exactly once.

- [x] **Step 2: Remove the outbound-selection flow**

Delete the select-outbound click helper and `listOutbounds`/`listReturns`. The page session loads one one-way page, waits for stable `.flight-item` cards, extracts every card, and records failure artifacts using stage `flight_list`.

- [x] **Step 3: Collect and rank return flights**

Use a single query:

```js
{
  from: 'URC',
  to: 'HGH',
  depart_date: '2026-10-08',
}
```

Filter and rank extracted cards once, log the accepted count, and return `{ scans, flights, errors }`.

- [x] **Step 4: Run focused browser and collector tests**

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js`

Expected: PASS.

### Task 3: Schema v3 state migration

**Files:**
- Modify: `src/state.js`
- Modify: `src/run.js`
- Modify: `tests/state.test.js`
- Modify: `tests/run.test.js`

- [x] **Step 1: Add schema v3 expectations**

Assert `collection_scope` is `return_one_way`, `current.best_price` contains the cheapest single-flight price, and `current.flights` keeps every accepted flight. Assert schema v1/v2 history remains unchanged and only a prior schema v3 return result can supply `last_success`.

- [x] **Step 2: Implement schema v3 output**

Build current state as:

```js
{
  availability: 'available',
  best_price: 1880,
  currency: 'CNY',
  flights: [],
}
```

Write failed collector results with stage `flight_list` and an empty `flights` array.

- [x] **Step 3: Run state and persistence tests**

Run: `node --test tests/state.test.js tests/run.test.js`

Expected: PASS.

### Task 4: User-facing documentation and full verification

**Files:**
- Modify: `README.md`

- [x] **Step 1: Replace the documented monitoring scope**

Document only `2026-10-08 URC → HGH`, arrival by `18:00`, accepted direct/stopover/through services, rejected transfers, stop durations no longer than 120 minutes when shown, one-way starting-price ordering, schema v3, and preservation of older history.

- [x] **Step 2: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 3: Check the final diff**

Run: `git diff --check`

Expected: no output.
