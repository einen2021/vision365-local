import { doc, getDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  formatLiveFeedTime,
  normalizeLiveFeedRow,
  pickAlarmLikeAppendTarget,
  pickTroubleAppendTarget,
} from "@/lib/liveAlarmFeedWrite";
import { normalizeBuildingName } from "@/lib/buildingNames";

export function buildingDbCollection(buildingName) {
  const base = normalizeBuildingName(buildingName);
  if (!base) return "";
  return base.endsWith("BuildingDB") ? base : `${base}BuildingDB`;
}

function mapRows(rows) {
  return [...rows]
    .map((r) => ({
      message: r.message || "",
      time: r.time,
      // Always derive a display clock from the numeric time field.
      formattedTime: formatLiveFeedTime(r.time),
      rawMessage: r.rawMessage || null,
    }))
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

function rowsFromDocData(data, fieldCandidates) {
  for (const key of fieldCandidates) {
    const chunk = data[key];
    if (Array.isArray(chunk)) {
      return mapRows(chunk.map(normalizeLiveFeedRow));
    }
  }
  return [];
}

export function rowsForAlarmMessagesSnap(snap) {
  if (!snap.exists()) return [];
  const data = snap.data() || {};
  return rowsFromDocData(data, ["alarmMessages", "alarmMessage", "messages"]);
}

export function rowsForLiveFireSnap(snap) {
  if (!snap.exists()) return [];
  const data = snap.data() || {};
  const fromLiveFire = rowsFromDocData(data, ["liveFire"]);
  if (fromLiveFire.length > 0) return fromLiveFire;
  const { rows } = pickAlarmLikeAppendTarget(data, "liveAlarm");
  return mapRows(rows);
}

export function rowsForLiveTroubleSnap(snap) {
  if (!snap.exists()) return [];
  const { rows } = pickTroubleAppendTarget(snap.data() || {});
  return mapRows(rows);
}

export function rowsForLiveSupervisorySnap(snap) {
  if (!snap.exists()) return [];
  const { rows } = pickAlarmLikeAppendTarget(snap.data() || {}, "liveSupervisory");
  return mapRows(rows);
}

async function readFirstExistingDoc(dbCol, docIds) {
  for (const docId of docIds) {
    const snap = await getDoc(doc(db, dbCol, docId));
    if (snap.exists()) return snap;
  }
  return null;
}

export async function fetchBuildingAlarmHistory(buildingName) {
  const dbCol = buildingDbCollection(buildingName);

  const [alarmSnap, liveFireSnap, liveTroubleSnap, liveSupervisorySnap] =
    await Promise.all([
      readFirstExistingDoc(dbCol, ["alarmMessages", "alarmMessage"]),
      readFirstExistingDoc(dbCol, ["liveFire", "liveAlarm"]),
      getDoc(doc(db, dbCol, "liveTrouble")),
      getDoc(doc(db, dbCol, "liveSupervisory")),
    ]);

  return {
    alarmMessages: alarmSnap ? rowsForAlarmMessagesSnap(alarmSnap) : [],
    liveFire: liveFireSnap ? rowsForLiveFireSnap(liveFireSnap) : [],
    liveTrouble: rowsForLiveTroubleSnap(liveTroubleSnap),
    liveSupervisory: rowsForLiveSupervisorySnap(liveSupervisorySnap),
  };
}
