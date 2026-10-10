# How commands are sent to the fire panel

This explains how Vision365 talks to the fire panel: how it decides when it's safe to send a
command, and how it confirms that the panel actually ran it.

The logic lives in the panel worker,
[desktop-server/src/workers/firePanelWorker.ts](../desktop-server/src/workers/firePanelWorker.ts)
(section "Sending commands"). Command sequences such as Silence Alarm are handled by
`sendFirePanelCommandsPriority` in
[desktop-server/src/services/firePanelService.ts](../desktop-server/src/services/firePanelService.ts).

## How the panel behaves

The panel's service port is a simple command line:

- When it's ready for a command, it shows a prompt: a single `-`.
- Everything you type is echoed back.
- **It only runs a command typed at the prompt.** A command that arrives while the panel is
  busy (still printing a response or an event) is echoed **without** the leading `-`, and
  ignored.

So the panel's own output shows what happened to each command:

```
-
- set 2:p217 on      <- typed at the prompt: executed

set 3:p217 on        <- arrived while the panel was busy: echoed, NOT executed
set 4:p217 on        <- same
-
```

This is why sending commands back-to-back with fixed delays doesn't work. Instead, every
command waits for the prompt, and is then confirmed by its echo.

## One path for every command

Every command the app sends follows the same steps, whatever triggered it. When a command is
sent (which button, which event) is decided by the app as before; this document covers only
how it is sent.

| Command | Sent when |
|---|---|
| `ack` | An Ack / Acknowledge button is clicked (navbar Fire / Trouble / Sup Ack, fire alert window, trouble / supervisory popup), or by AutoPilot |
| `ack f <addr>` / `ack t <addr>` / `ack s <addr>` | A single device is acknowledged from a live list |
| `show counts` | After fire, trouble, supervisory, acknowledge, restore and reset events |
| `list f`, `list t`, `list s` | At startup, when a category's count changes, and when a live list page refreshes |
| `login 333` | Before Silence Alarm, Reset System, Disable and Enable, unless already logged in |
| `set 2:p217 on`, `set 3:p217 on`, `set 4:p217 on` | Silence Alarm |
| `set 2:p212 on`, `set 3:p212 on`, `set 4:p212 on` | Reset System |
| `disable <addr> on` / `disable <addr> off` | Disable / Enable a device |
| `show <addr>`, `cshow …` | Device details, asset upload |
| anything typed | The terminal on the Network page |

### The steps

```
send "ack"
 │
 ├─ wait for its turn ─────────────── only one command talks to the panel at a time
 │
 ├─ wait until the panel is ready ─── see "Waiting for the prompt"
 │
 ├─ send "ack"                        log: sent (attempt 1)
 │
 └─ wait up to 5 s for the echo
      │
      ├─ "- ack"  (with the dash) → EXECUTED: done
      │
      ├─ "ack"    (no dash)       → IGNORED: wait for the prompt again and resend
      │                             (at most 3 attempts in total)
      │
      └─ no echo at all           → FAILED: not resent (see below)
```

### Why a missing echo is not retried

An echo without the dash means the panel clearly ignored the command, so sending it again is
safe.

If **no echo arrives at all**, nobody knows what happened. The panel might have run the
command and only the echo was lost, or it might never have received it. Resending could run
a command that changes the system, such as a reset, twice. So the app stops and reports the
failure instead of guessing.

The exceptions are commands where running twice is harmless: `login 333`, and commands that
only read from the panel (`list …`, `show …`, `cshow …`). They are retried even when their
result is unclear (up to their attempt limit).

The app itself never resends an `ack`: once the worker reports it executed, a second `ack`
would acknowledge a different event. The panel can take 10–30 s to print `FIRE ALARM ACKED`
after a fire, so that line is not waited for.

## Waiting for the prompt

Before each command, the app waits until the panel is sitting at its `-` prompt:

1. **Watch the output.** If the last line the panel printed is exactly `-`, the panel is
   ready. Any other output means it's busy. Sending anything also counts as busy, until the
   panel prints a new prompt.
2. **Let it settle.** When the prompt appears, wait 0.05 s and check the prompt is *still*
   the last thing printed, meaning nothing (such as an event) arrived in between. Only then
   send.
3. **Recover a hidden prompt.** If the panel prints an event after its prompt, the output no
   longer ends in `-`. If no prompt shows within 2 s, the app presses Enter (sends a blank
   line), which makes the panel print a fresh `-`. This repeats every 2 s.
4. **Give up.** If there's still no prompt after 10 s, the command fails as "panel not ready"
   and is not sent. Nothing is ever sent to a panel that hasn't become ready.

## Recognising the echo

While a command waits for its echo, each complete line from the panel is compared with it:

- A leading `-` and spaces are separated from the rest of the line.
- The rest is compared with the command, ignoring upper/lower case and extra spaces.
- If it matches, a leading `-` means **executed** and no `-` means **ignored**.
- An echo at the end of other output (for example `… CORRIDOR COSlist f`, typed while the
  panel was printing an event) is **interrupted**: the panel may still run it afterwards (it
  did with `list f`), so its outcome is unknown. Commands that only read (`list`, `show`,
  `cshow`) are resent; anything that changes the panel (`ack`, `set`, `disable`) fails
  without being resent.

The prompt `- ` is printed before the command is typed, and the echo completes that same line
(`- ack`), so the line already on screen when a command is sent is part of what's compared.

Lines that don't match (event logs, list output, other text) are left to the normal message
handling.

## Order and overlap

- **One at a time, in arrival order.** Commands queue up. A command doesn't start until the
  one before it has been confirmed or has failed. There is no priority between commands: an
  `ack` sent while a `list t` is printing waits until the list has finished.
- **Different sources can take turns.** For example, an automatic `show counts` can run in
  between Silence Alarm's `set` commands. Each command still waits for its own prompt, so
  they never collide.
- **Only one `show counts` waits in the queue at a time.** A `show counts` requested while
  one is already waiting shares its answer instead of being queued again.
- **Silence and Reset never overlap.** Only one Silence Alarm or Reset System runs at a time,
  so their `set` sequences can't get mixed up.
- **The screen stays responsive.** A slow command, such as a login waiting for the panel,
  doesn't block other clicks.

## Commands with extra steps

### Silence Alarm and Reset System

```
log in          → "login 333 -> ACCESS GRANTED (attempt 1)"
                   or "already logged in (142s left), login skipped"
set 2:p217 on   → "- set 2:p217 on"
set 3:p217 on   → "- set 3:p217 on"
set 4:p217 on   → "- set 4:p217 on"
```

Reset System is the same with `p212`. If any step fails, the remaining commands are not sent
and the button reports the error.

### Logging in

1. **Skip if logged in recently.** After the panel answers `ACCESS GRANTED`, logins are
   skipped for the next 3 minutes. Any ACCESS GRANTED counts, including a `login 333` typed
   in the terminal. An `ACCESS DENIED`, or reconnecting to the panel, ends this early.
2. **Otherwise** send `login 333` and wait up to 3 s for the panel's answer.
3. **ACCESS GRANTED:** done. **Anything else** (`%ERROR`, ACCESS DENIED, no answer, or the
   echo showed it was ignored): try again straight away, up to 5 attempts.
4. After 5 failed attempts the action stops with "Login failed". **A `set` command is never
   sent without a successful login.**

### Lists

A list's response is everything printed between the command's echo and the next `-` prompt.
The app waits up to 60 s for a list to finish; the rows are streamed to the caller as they
arrive. If the prompt doesn't come within 60 s, what arrived so far is returned.

### Other responses

`show counts`, `show <addr>`, `disable`, `enable` and typed commands return everything
printed between the echo and the next `-` prompt, waiting up to 5 s. `ack` and `set` print
nothing of their own, so they're done as soon as their echo shows they were executed.

## What doesn't go through these steps

| What | Why |
|---|---|
| Telnet handshake replies | Part of the connection protocol, not panel commands |
| The Enter (blank line) used to recover a hidden prompt | It's how the app *gets* a prompt, so it can't wait for one |
| An empty command from the terminal | Sends a blank line by hand, to get a fresh prompt |

## What gets logged

Every attempt and result is recorded in the server log and sent on the panel log stream
(`kind: "system"`, `systemType: "command"`), so it shows on the Network page:

```
CMD    ack   sent (attempt 1)
CMD    ack   IGNORED by panel (no "-" prompt), retrying
CMD    ack   sent (attempt 2)
CMD    - ack   EXECUTED
CMD    show counts   FAILED: No echo received for 'show counts'; execution status is unknown, not resent
```

## Timings

| Setting | Value | Meaning |
|---|---|---|
| Settle time | 0.05 s | Wait after the prompt appears, before sending |
| Prompt wait | 10 s | Longest wait for the prompt before a command fails |
| Prompt recovery | 2 s | No prompt for this long: press Enter to get one |
| Echo wait | 5 s | Longest wait for a command's echo |
| Attempts | 3 | Tries for a command the panel explicitly ignored |
| Login answer wait | 3 s | Longest wait for the answer to `login 333` |
| Login attempts | 5 | Login tries before giving up |
| Login reuse | 3 min | How long an ACCESS GRANTED is reused |
| List wait | 60 s | Longest wait for a list to finish |
| Response wait | 5 s | Longest wait for any other response to reach the prompt |

## What this assumes about the panel

This logic is based on how the panel behaved in the logs seen so far. If it behaves
differently, these are the points to check:

- **It echoes every command typed.** Confirmation depends on the echo. A command the panel
  doesn't echo will always end as "no echo" and fail.
- **An ignored command is echoed without the `-`.** This is what separates "ignored" from
  "executed".
- **Pressing Enter at an idle panel just prints a new prompt.** Prompt recovery relies on
  this being harmless.
- **A login lasts at least 3 minutes.** If the panel logs out sooner, `set` commands sent
  within the 3 minutes could be refused.
- **A list ends with the `-` prompt.** If the panel splits long lists into pages (for example
  "press a key for more"), a list would stop early or time out.
