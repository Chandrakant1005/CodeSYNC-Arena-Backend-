import { randomUUID } from "crypto";

export function generateMeetingCode() {
  return randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export function generateRoomSlug(title) {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const suffix = randomUUID().slice(0, 6);
  return `${base || "meeting-room"}-${suffix}`;
}
