# Vision365 Fire Panel Command Priority Architecture

This document defines the **domain-driven operational priority hierarchy and real-time preemption engine** for all commands communicated to the Simplex Fire Alarm Panel over the Telnet interface (`desktop-server/src/workers/firePanelWorker.ts`).

---

## 1. Life-Safety Priority Philosophy

In fire alarm management systems:
1. **Active Monitoring & Fire Emergencies take absolute precedence**.
2. **Only `list f` (Live Fire List) waits for full response completion**.
3. **`list t` (Trouble) and `list s` (Supervisory) DO NOT wait for completion**. Chunks are listened to, filtered in real-time, and emitted to UI/logs without holding up the telnet worker.
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

## 3. Dynamic Preemption Engine (`Block Low Priority & Focus on High Priority`)

When a high-priority command arrives while a lower-priority command is currently executing on the panel socket:

1. **Immediate Socket Preemption (`preemptActiveCommand`)**:
   - Compares `activeCommandPriority > incomingPriority`.
   - `preemptActiveCommand()` triggers immediately on the active low-priority command.
   - The lower-priority command yields the socket early without blocking.

2. **Lower-Priority Queue Purge (`deferPendingLowerPriorityCommands`)**:
   - Queued commands of lower priority than the incoming command are deferred.

3. **Instant High-Priority Execution**:
   - The high-priority command takes over the socket immediately.

---

## 4. Frontend & Log Chunk Parsing

- **Streaming Listeners (`streamFirePanelListCommand`)**: Receive live partial chunks from worker threads as `list t` / `list s` data arrives.
- **Filtering & Parsing (`parsePanelListResponse`)**: Sanitizes NUL bytes, strips header lines (`list t`, `list s`, `_DNE`), breaks by device pattern (`N:M#-#-#`), and converts raw streams into structured entries without waiting for complete panel dumps.
