"use client";

import { useSyncExternalStore } from "react";
import {
  followedSnapshot,
  recentSnapshot,
  subscribeFollow,
  subscribeRecent,
  type RecentItem,
} from "@/lib/retention/storage";

const EMPTY: readonly string[] = Object.freeze([]);
const EMPTY_RECENT: readonly RecentItem[] = Object.freeze([]);

const serverFollowed = () => EMPTY;
const serverRecent = () => EMPTY_RECENT;

export function useFollowed(): readonly string[] {
  return useSyncExternalStore(subscribeFollow, followedSnapshot, serverFollowed);
}

export function useRecent(): readonly RecentItem[] {
  return useSyncExternalStore(subscribeRecent, recentSnapshot, serverRecent);
}
