# Fire List Refresh After Acknowledge (Fire Modal)

Traces what happens, step by step, from the moment a user clicks **Acknowledge**
on the fire alarm modal to the moment the fire list / device statuses are
back in sync. Source of truth: [`FireModalContext.jsx`](../src/contexts/FireModalContext.jsx).

## 1. Trigger — user clicks "Acknowledge"

`FireAlertModalView`'s Acknowledge button calls `onAcknowledge`, wired to
`handleAcknowledge()` in `FireAlertProvider`
([FireModalContext.jsx:355-389](../src/contexts/FireModalContext.jsx#L355-L389)).

`handleAcknowledge` first checks `useFirePanelStore.getState().connected` —
if not connected, it toasts an error and stops.

**Synchronous, immediate UI response** (before any panel round trip):
1. `muteSiren()` — stops the fire siren instantly.
2. `closeFireAlertModal()` — hides the modal.
3. `router.push(LIVE_FIRE_ROUTE)` — navigates to the live fire list page.

Everything below then runs in a detached `void (async () => {...})()` block —
the UI does not wait on it.

## 2. Send `ack` to the panel

```js
await sendPriorityPanelCommand("ack", 2000);
```

`sendPriorityPanelCommand` ([acknowledgePanelDevice.js:14-25](../src/lib/acknowledgePanelDevice.js#L14-L25))
POSTs to `/api/telnet/fire-panel/command/priority`. This is a **priority**
queue endpoint — it jumps ahead of any command already queued (e.g. an
in-flight `list f` dump or the background CVAL polling loop), rather than
waiting behind it on the shared telnet connection.

## 3. Counts + fire list refresh — run together

```js
const results = await Promise.allSettled([
  fetchAndSyncCounts(),
  runPriorityFireListSync(),
]);
```

These are two independent panel round trips, run concurrently via
`Promise.allSettled` (one's failure doesn't block the other) instead of
sequentially.

### 3a. `fetchAndSyncCounts()` ([FireModalContext.jsx:245-301](../src/contexts/FireModalContext.jsx#L245-L301))

1. POSTs `"show counts"` to `/api/telnet/fire-panel/command`.
2. Parses the response with `parseShowCountsResponse` → `{ totalFire, totalTrouble, totalSupervisory }`.
3. Saves the counts to the backend via `POST /api/telnet/fire-panel/panel-state`.
4. Dispatches a `vision365:firePanelStateUpdated` window `CustomEvent` so
   `AppContext` and any listening UI update immediately.
5. Compares against `previousCountsRef` — for any category whose count
   **decreased** (something resolved/acked off-panel), re-runs that
   category's full list sync (`syncFireListAssets()`, `syncTroubleListAssets()`,
   or `syncSupervisoryListAssets()` from `systemResetWorkflow.js`) so the
   list DB and device flags stay consistent even for categories not touched
   by this ack.
6. Updates `previousCountsRef` to the new totals.

### 3b. `runPriorityFireListSync()` ([FireModalContext.jsx:320-353](../src/contexts/FireModalContext.jsx#L320-L353))

Wrapped in `withMonitorPausedForPriority` (pauses the background CVAL/list
monitor loop for the duration, then resumes it — see
[firePanelMonitorSession.js](../src/lib/firePanelMonitorSession.js)):

1. Sends `"list f"` via `sendPriorityPanelCommand` (1s timeout) — again
   jumping the priority queue instead of racing the regular monitor loop's
   own `list f` poll.
2. `parsePanelListResponse(rawText)` → array of row objects (address,
   location, device type, status, etc.).
3. `extractPanelDeviceAddresses(rawText)` → deduped, uppercased list of
   device addresses currently in the Fire list
   ([firePanelMonitor.js:108-113](../src/lib/firePanelMonitor.js#L108-L113)).
4. `syncPanelListWithTempArray("Fire", parsedRows)` — updates the in-memory
   temp-array baseline used to detect "new since last dump" rows for history
   ([firePanelListHistory.js](../src/lib/firePanelListHistory.js)).
5. `saveListToCategoryDb("Fire", parsedRows)` — **full overwrite** (`setDoc`
   with `merge: true`, but the `rows` array itself is replaced wholesale) of
   `fire-list/current` and `panel-lists/fire-list` in Firestore, so the
   stored list always matches exactly what the panel just reported —
   anything acknowledged/cleared drops out automatically
   ([recordAlarmHistory.js:156-177](../src/lib/recordAlarmHistory.js#L156-L177)).
6. `syncAssetsListWithPanelList("Fire", fireAddresses)` — reconciles the
   `AssetsList` Firestore collection's `simplexStatus.F` flags against the
   addresses just seen:
   - Diffs the new address list against the previous run's address list
     (per-category temp array in
     [panelListAssetSync.js](../src/lib/panelListAssetSync.js)).
   - Newly-added addresses → `F: 1`.
   - Addresses that dropped out (i.e. cleared by this ack) → `F: 0`.
   - Updates the in-memory `useAssetFireStatusStore` instantly (0ms), then
     writes the Firestore diffs concurrently via `Promise.all`.
7. `useAssetFireStatusStore.getState().scheduleSyncFromAssetsList()` —
   final store reconciliation pass.

## 4. Result

By the time both promises settle, the panel has acknowledged the alarm, the
live counts badge is updated in the UI/DB, `fire-list/current` in Firestore
reflects exactly the panel's current `list f` output, and every device's
`simplexStatus.F` flag in `AssetsList` matches that same list — all without
blocking the UI, which already navigated to the live fire page and silenced
the siren the moment Acknowledge was clicked.

## Why priority commands, not the regular sync path

`syncFireListAssets()` (used elsewhere, e.g. by `fetchAndSyncCounts`'s
decrease-detection and by the SSE listener's non-priority paths) sends
non-priority commands that can queue behind the background monitor loop's
own polling. The Acknowledge button instead uses `sendPriorityPanelCommand`
+ `withMonitorPausedForPriority` throughout, because a user who just clicked
Acknowledge is waiting on visible feedback and shouldn't sit behind a
200-row list dump or the next scheduled CVAL poll.
