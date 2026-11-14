// Share card for /declines/[id].
import { declineCard } from "@/app/_og/cards";

export const alt = "StrikeHike 20% S&P fall reference";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return declineCard(id);
}
