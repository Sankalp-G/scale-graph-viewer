import { useSyncExternalStore } from "react";

export type EdgeResult = {
  edge_id: string;
  count: number;
  classification: number;
};

export type EdgeCountPoint = {
  timestamp: string | null;
  total: number;
  receivedAt: number;
};

type EdgeResultsState = {
  points: EdgeCountPoint[];
  latestEdgeResults: EdgeResult[];
};

const MAX_POINTS = 180;

let state: EdgeResultsState = { points: [], latestEdgeResults: [] };
const listeners = new Set<() => void>();

const emitChange = () => {
  for (const listener of listeners) {
    listener();
  }
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const recordEdgeResults = (edgeResults: EdgeResult[], timestamp?: string | null) => {
  const totalCount = edgeResults.reduce((sum, result) => sum + toNumber(result.count), 0);
  const point: EdgeCountPoint = {
    timestamp: timestamp ?? null,
    total: totalCount,
    receivedAt: Date.now(),
  };
  state = {
    points: [...state.points, point].slice(-MAX_POINTS),
    latestEdgeResults: edgeResults.slice(),
  };
  emitChange();
};

export const resetEdgeResults = () => {
  state = { points: [], latestEdgeResults: [] };
  emitChange();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

export const useEdgeResultsStore = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
