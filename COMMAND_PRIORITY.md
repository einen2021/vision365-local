# Vision365 Fire Panel Command Priority Architecture

> **Superseded.** The panel worker no longer ranks or preempts commands. Every
> command now runs one at a time in arrival order, waits for the panel's `-`
> prompt and is confirmed by its echo — see [docs/PANEL_COMMANDS.md](docs/PANEL_COMMANDS.md).

This document defines the **domain-driven operational priority hierarchy and real-time preemption engine** for all commands communicated to the Simplex Fire Alarm Panel over the Telnet interface (`desktop-server/src/workers/firePanelWorker.ts`).

---

## 1. Life-Safety Priority Philosophy

In fire alarm management systems:
1. **Active Monitoring & Fire Emergencies take absolute precedence**.
2. **Only `list f` (Live Fire List) waits for full response completion**.
3. **`list t` (Trouble) and `list s` (Supervisory) stream partial chunks** (throttled to ~10/s) so the UI fills as rows arrive; any higher-rank command preempts them.
4. If any lower-priority command is running and a higher-priority command arrives, the system **preempts (blocks/finishes early) the lower-priority command** instantly.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   RANK 1: ACTIVE MONITORING (HIGHEST PRIORITY)              │
│   • Background Health & Alarm Detection: cshow cval                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                   RANK 2: FIRE ACKNOWLEDGMENT & SAFETY CONTROLS             │
│   • Fire Acknowledgment: ack f, ack f <addr>                                │
│   • Alarm Silencing: silence                                                │
│   • Panel Authorization & Safety: login <pass>, set p212/p217 on            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                   RANK 3: LIVE FIRE LIST STREAMING (FULL WAIT)              │
│   • Fire Alarm List: list f (Waits for complete fire dump)                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│       RANK 4: SUPERVISORY & TROUBLE OPERATIONS (NON-BLOCKING FAST STREAM)   │
│   • Supervisory: ack s, ack s <addr>, list s (Fast stream & filter — no wait)│
│   • Trouble: ack t, ack t <addr>, list t (Fast stream & filter — no wait)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│             RANK 5: INTERACTIVE DEVICE INSPECTION                           │
│   • Real-time Device Query: show <address> (Asset Control Modal)            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│             RANK 6: MANUAL TERMINAL & CONSOLE COMMANDS                      │
│   • Telnet Client terminal commands (/dashboard/network)                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│           RANK 7: BATCH EXPORTS & SYSTEM SETUP (LOWEST/BACKGROUND)          │
│   • Full System Dump: cshow * (Upload Assets / Asset Mapping)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Command Priority & Waiting Behavior

| Priority Rank | Category | Commands | Waiting & Operational Behavior |
| :--- | :--- | :--- | :--- |
| **Rank 1<br>(Highest)** | **Active Panel Monitoring** | • `cshow cval`<br>(Fire/Trouble/Sup counts) | • **Highest Precedence**: Continuous detection polling in milliseconds.<br>• Instantly preempts lower-priority running commands. |
| **Rank 2<br>(Critical)** | **Fire Acknowledgment & Safety** | • `ack f`<br>• `ack f <address>`<br>• `silence`<br>• `login <passcode>`<br>• `set p212/p217 on` | • **Immediate Safety Response**: Acknowledges active fire alarms and silences alarms.<br>• Blocks lower-priority commands immediately on the socket. |
| **Rank 3<br>(High)** | **Live Fire List Streaming** | • `list f` (Fire List) | • **ONLY list f waits for full completion**: Keeps reading until `_DNE` / total Fire count is reached or full idle timeout. |
| **Rank 4<br>(Medium-High)** | **Supervisory & Trouble Signals** | • `ack s` / `ack s <address>`<br>• `ack t` / `ack t <address>`<br>• `list s`<br>• `list t` | • **DO NOT WAIT FOR FULL DUMP**: Chunks are streamed and filtered in real-time (`parsePanelListResponse`), and the command fast-completes immediately after receiving initial data.<br>• Never holds open the socket waiting for 100+ rows. |
| **Rank 5<br>(Medium)** | **Device Inspection** | • `show <address>`<br>(e.g. `show 2:M1-2-0`) | • Queries real-time `PRIMARY STATUS` and `ENABLED STATE` in Asset Control modal.<br>• Fast completion on status fields. |
| **Rank 6<br>(Standard)** | **Manual Terminal / Diagnostics** | • Custom panel commands | • Manual inputs typed into Telnet Client console (`/dashboard/network`). |
| **Rank 7<br>(Lowest)** | **Bulk Setup & Device Exports** | • `cshow *`<br>• Full system exports | • Used for initial asset collection and setup. |

---

## 3. Dynamic Preemption Engine (as implemented in `firePanelWorker.ts`)

1. **Ranked queue** — `rankFor(command)` assigns the rank from the command text
   (ack/silence/login/set → 2, `list f` → 3, `list t/s` + `show counts` → 4,
   `show`/`disable`/`enable` → 5, other → 6, `cshow *` → 7). The next command is
   the lowest rank in the queue, FIFO within a rank.

2. **Dump preemption (`preemptActiveDump`)** — when a command arrives with a lower
   rank number than an active `list`/`cshow` dump, the dump stops collecting and
   the new command is written immediately. The dump is then settled by whichever
   shows up first in the telnet stream:
   - the urgent command's **echo** → the panel aborted the dump → the dump is
     re-queued at the front of its rank and restarts after the urgent commands;
   - the dump's **end** (`-` prompt / `_DNE` with the expected row count) → the
     panel queued the urgent command behind the dump → the original dump is
     completed from the rows that kept arriving (no second dump).
   Either way the caller gets one complete response for its request id.

3. **Fire-and-forget writes** — `ack …` and `set …` are written to the socket and
   resolved at once (the panel processes input in order), so silence/reset
   (`login` + 3× `set`) cost about one login round trip. Callers send these as one
   batch: `POST /api/telnet/fire-panel/command/priority` with `commands: [...]`.

4. **Echo gate** — the first collecting command after a preemption ignores panel
   text until its own echo arrives (or the line is quiet for 300 ms), so a
   cancelled dump's tail does not leak into its response.

The browser does not serialize panel commands (`withMonitorPaused` only tracks a
pause counter); ordering is owned by the worker.

Local check: `node scripts/fake-panel.mjs 2323 200 30 [abort|queue]` and
`node scripts/fake-panel-bench.mjs 2323 200` (after `npm run desktop:worker:build`).

---

## 4. Frontend & Log Chunk Parsing

- **Streaming Listeners (`streamFirePanelListCommand`)**: Receive live partial chunks from worker threads as `list t` / `list s` data arrives.
- **Filtering & Parsing (`parsePanelListResponse`)**: Sanitizes NUL bytes, strips header lines (`list t`, `list s`, `_DNE`), breaks by device pattern (`N:M#-#-#`), and converts raw streams into structured entries without waiting for complete panel dumps.
