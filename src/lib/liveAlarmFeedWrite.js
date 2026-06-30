/**
 * Helpers for liveAlarm / liveSupervisory / liveTrouble Firestore documents
 * (array or legacy message field shapes).
 */

function coerceLiveFeedTime(raw) {
  if (raw == null) return Date.now()
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string") {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof raw === "object" && raw !== null && typeof raw.toDate === "function") {
    const d = raw.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : Date.now()
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : Date.now()
}

export function normalizeLiveFeedRow(raw) {
  if (!raw || typeof raw !== "object") return { message: "", time: Date.now() }
  const message =
    typeof raw.message === "string"
      ? raw.message
      : raw.message != null
        ? String(raw.message)
        : ""
  const time = coerceLiveFeedTime(raw.time)
  return { message, time }
}

export function pickAlarmLikeAppendTarget(docData, canonicalDocId) {
  const fallbackOrder =
    canonicalDocId === "liveAlarm"
      ? ["liveAlarm", "messages", "alarmMessage"]
      : ["liveSupervisory", "messages", "alarmMessage"]
  for (const key of fallbackOrder) {
    const chunk = docData[key]
    if (Array.isArray(chunk)) {
      return { fieldKey: key, rows: chunk.map(normalizeLiveFeedRow) }
    }
  }
  return { fieldKey: canonicalDocId === "liveAlarm" ? "liveAlarm" : "liveSupervisory", rows: [] }
}

export function pickTroubleAppendTarget(docData) {
  const lt = docData.liveTrouble
  if (Array.isArray(lt)) {
    return { fieldKey: "liveTrouble", rows: lt.map(normalizeLiveFeedRow) }
  }
  if (lt && typeof lt === "object") {
    return { fieldKey: "liveTrouble", rows: [normalizeLiveFeedRow(lt)] }
  }
  if (Array.isArray(docData.messages)) {
    return { fieldKey: "messages", rows: docData.messages.map(normalizeLiveFeedRow) }
  }
  if (Array.isArray(docData.alarmMessage)) {
    return { fieldKey: "alarmMessage", rows: docData.alarmMessage.map(normalizeLiveFeedRow) }
  }
  return { fieldKey: "liveTrouble", rows: [] }
}

export function countLiveFeedDocRows(snap, canonicalDocId) {
  if (!snap.exists()) return 0
  const data = snap.data() || {}
  if (canonicalDocId === "liveTrouble") {
    return pickTroubleAppendTarget(data).rows.length
  }
  return pickAlarmLikeAppendTarget(data, canonicalDocId).rows.length
}

export function formatLiveFeedTime(ms) {
  try {
    const n = typeof ms === "number" ? ms : Number(ms)
    if (!Number.isFinite(n)) return "—"
    return new Date(n).toLocaleString()
  } catch {
    return "—"
  }
}

/** Rows for UI tables (same field resolution as append path) */
export function rowsForLiveAlarmLikeDisplay(snap, canonicalDocId) {
  if (!snap.exists()) return []
  const { rows } = pickAlarmLikeAppendTarget(snap.data() || {}, canonicalDocId)
  return rows.map((r) => ({
    message: r.message || "",
    time: r.time,
    formattedTime: formatLiveFeedTime(r.time),
  }))
}

export function rowsForLiveTroubleDisplay(snap) {
  if (!snap.exists()) return []
  const { rows } = pickTroubleAppendTarget(snap.data() || {})
  return rows.map((r) => ({
    message: r.message || "",
    time: r.time,
    formattedTime: formatLiveFeedTime(r.time),
  }))
}
