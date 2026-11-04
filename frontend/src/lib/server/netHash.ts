import { createHmac, randomBytes } from "node:crypto";

// The raw address never leaves this function. The daily salt lives only in
// this process; a restart starts a new salt.
let salt = randomBytes(32);
let saltDay = "";

function istDay() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function networkPrefix(ip: string) {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0/24` : "unknown";
  }
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
    ...right,
  ];
  return groups.length >= 3 ? `${groups.slice(0, 3).join(":")}::/48` : "unknown";
}

export function networkHash(request: Request) {
  const day = istDay();
  if (day !== saltDay) {
    salt = randomBytes(32);
    saltDay = day;
  }
  const prefix = networkPrefix(clientIp(request));
  return createHmac("sha256", salt).update(prefix).digest("hex");
}
