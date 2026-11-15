"use client";

import { ChangeNote } from "@/components/retention/ChangeNote";
import { RecentlyViewed } from "@/components/retention/RecentlyViewed";
import { YourThemes, type YourTheme } from "@/components/retention/YourThemes";

// The three retention blocks all read localStorage after mount and render
// nothing in the server HTML. They live in one module so a single client chunk
// can serve all three; RetentionLazy loads that chunk after hydration instead
// of putting it in the route's first script set.
type Props =
  | { slot: "change"; where: "home" | "upcoming" }
  | { slot: "recent"; className?: string }
  | { slot: "themes"; themes: YourTheme[] };

export function Retention(props: Props) {
  if (props.slot === "change") return <ChangeNote where={props.where} />;
  if (props.slot === "recent") return <RecentlyViewed className={props.className} />;
  return <YourThemes themes={props.themes} />;
}
