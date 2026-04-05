import pool from "../config/db.js";
import { generateMeetingCode, generateRoomSlug } from "../utils/generateMeeting.js";

function formatMeeting(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    roomSlug: row.room_slug,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    owner: {
      id: row.owner_id,
      fullName: row.owner_name,
      email: row.owner_email
    }
  };
}

async function getMeetingByIdentifier(identifier) {
  const normalized = identifier.trim();
  const roomSlug = normalized.split("/").filter(Boolean).pop();

  const [rows] = await pool.query(
    `SELECT m.*, u.full_name AS owner_name, u.email AS owner_email
     FROM meetings m
     JOIN users u ON u.id = m.owner_id
     WHERE m.meeting_id = ? OR m.room_slug = ?`,
    [normalized, roomSlug]
  );

  return rows[0] || null;
}

export async function createMeeting(req, res) {
  const { title } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ message: "Meeting title is required." });
  }

  try {
    const meetingId = generateMeetingCode();
    const roomSlug = generateRoomSlug(title);

    const [result] = await pool.query(
      "INSERT INTO meetings (meeting_id, room_slug, title, owner_id) VALUES (?, ?, ?, ?)",
      [meetingId, roomSlug, title.trim(), req.user.id]
    );

    const [rows] = await pool.query(
      `SELECT m.*, u.full_name AS owner_name, u.email AS owner_email
       FROM meetings m
       JOIN users u ON u.id = m.owner_id
       WHERE m.id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      meeting: formatMeeting(rows[0]),
      joinUrl: `${process.env.CLIENT_URL || "http://localhost:5173"}/meeting/${rows[0].room_slug}`
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create meeting right now." });
  }
}

export async function getMyMeetings(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT m.*, u.full_name AS owner_name, u.email AS owner_email
       FROM meetings m
       JOIN users u ON u.id = m.owner_id
       WHERE m.owner_id = ?
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );

    return res.json({ meetings: rows.map(formatMeeting) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to fetch meetings right now." });
  }
}

export async function joinMeetingLookup(req, res) {
  const { identifier } = req.body;

  if (!identifier?.trim()) {
    return res.status(400).json({ message: "Meeting ID or URL is required." });
  }

  try {
    const meeting = await getMeetingByIdentifier(identifier);

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found." });
    }

    return res.json({
      meeting: formatMeeting(meeting),
      joinUrl: `${process.env.CLIENT_URL || "http://localhost:5173"}/meeting/${meeting.room_slug}`
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to find that meeting right now." });
  }
}

export async function getMeetingDetails(req, res) {
  try {
    const meeting = await getMeetingByIdentifier(req.params.identifier);

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found." });
    }

    const [participants] = await pool.query(
      `SELECT mp.id, mp.joined_at, mp.left_at, mp.is_active, u.id AS user_id, u.full_name, u.email
       FROM meeting_participants mp
       JOIN users u ON u.id = mp.user_id
       WHERE mp.meeting_id = ?
       ORDER BY mp.joined_at DESC`,
      [meeting.id]
    );

    return res.json({
      meeting: formatMeeting(meeting),
      participants: participants.map((participant) => ({
        id: participant.id,
        joinedAt: participant.joined_at,
        leftAt: participant.left_at,
        isActive: Boolean(participant.is_active),
        user: {
          id: participant.user_id,
          fullName: participant.full_name,
          email: participant.email
        }
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to fetch meeting details right now." });
  }
}

export async function markMeetingEnded(req, res) {
  try {
    const meeting = await getMeetingByIdentifier(req.params.identifier);

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found." });
    }

    if (meeting.owner_id !== req.user.id) {
      return res.status(403).json({ message: "Only the meeting owner can end this meeting." });
    }

    await pool.query("UPDATE meetings SET status = 'ended' WHERE id = ?", [meeting.id]);
    await pool.query(
      "UPDATE meeting_participants SET is_active = 0, left_at = CURRENT_TIMESTAMP WHERE meeting_id = ? AND is_active = 1",
      [meeting.id]
    );

    return res.json({ message: "Meeting ended successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to end meeting right now." });
  }
}
