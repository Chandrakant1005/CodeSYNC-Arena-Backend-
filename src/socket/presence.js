import pool from "../config/db.js";

const presenceByMeeting = new Map();
const socketToPresence = new Map();
const whiteboardsByMeeting = new Map();

function getWhiteboard(roomKey) {
  if (!whiteboardsByMeeting.has(roomKey)) {
    whiteboardsByMeeting.set(roomKey, {
      visible: false,
      canGuestsDraw: false,
      strokes: []
    });
  }

  return whiteboardsByMeeting.get(roomKey);
}

function canDraw(presence) {
  if (!presence) {
    return false;
  }

  const whiteboard = getWhiteboard(presence.roomKey);
  return presence.user.id === presence.meetingOwnerId || whiteboard.canGuestsDraw;
}

function serializePresenceItem(item) {
  return {
    socketId: item.socketId,
    sessionId: item.sessionId,
    joinedAt: item.joinedAt,
    user: item.user
  };
}

function emitRoster(io, roomKey) {
  const roster = [...(presenceByMeeting.get(roomKey)?.values() || [])].map(serializePresenceItem);
  io.to(roomKey).emit("meeting:roster", roster);
}

async function resolveMeeting(identifier) {
  const roomSlug = identifier.split("/").filter(Boolean).pop();
  const [rows] = await pool.query(
    `SELECT m.*, u.full_name AS owner_name, u.email AS owner_email
     FROM meetings m
     JOIN users u ON u.id = m.owner_id
     WHERE m.room_slug = ? OR m.meeting_id = ?`,
    [roomSlug, identifier]
  );
  return rows[0] || null;
}

async function markJoined(meetingDbId, userId) {
  const [activeRows] = await pool.query(
    `SELECT id
     FROM meeting_participants
     WHERE meeting_id = ? AND user_id = ? AND is_active = 1
     ORDER BY joined_at DESC
     LIMIT 1`,
    [meetingDbId, userId]
  );

  if (activeRows.length) {
    await pool.query(
      `UPDATE meeting_participants
       SET joined_at = CURRENT_TIMESTAMP, left_at = NULL
       WHERE id = ?`,
      [activeRows[0].id]
    );
    return;
  }

  await pool.query(
    "INSERT INTO meeting_participants (meeting_id, user_id, is_active) VALUES (?, ?, 1)",
    [meetingDbId, userId]
  );
}

async function markLeft(meetingDbId, userId) {
  await pool.query(
    `UPDATE meeting_participants
     SET is_active = 0, left_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM meeting_participants
         WHERE meeting_id = ? AND user_id = ? AND is_active = 1
         ORDER BY joined_at DESC
         LIMIT 1
       ) AS latest_active
     )`,
    [meetingDbId, userId]
  );
}

export function registerMeetingSocket(io, socket) {
  socket.on("meeting:join", async ({ identifier, user, sessionId }) => {
    try {
      const meeting = await resolveMeeting(identifier);
      if (!meeting) {
        socket.emit("meeting:error", { message: "Meeting was not found." });
        return;
      }

      const roomKey = `meeting:${meeting.room_slug}`;
      socket.join(roomKey);

      const participants = presenceByMeeting.get(roomKey) || new Map();
      const presence = {
        meetingDbId: meeting.id,
        meetingOwnerId: meeting.owner_id,
        meetingIdentifier: meeting.room_slug,
        sessionId,
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
        user
      };

      participants.set(socket.id, presence);
      presenceByMeeting.set(roomKey, participants);
      socketToPresence.set(socket.id, { roomKey, ...presence });

      await markJoined(meeting.id, user.id);

      socket.emit("meeting:joined", {
        roomKey,
        socketId: socket.id,
        peers: [...participants.values()]
          .filter((item) => item.socketId !== socket.id)
          .map(serializePresenceItem)
      });

      const whiteboard = getWhiteboard(roomKey);
      socket.emit("whiteboard:init", {
        visible: whiteboard.visible,
        strokes: whiteboard.strokes,
        canGuestsDraw: whiteboard.canGuestsDraw,
        ownerId: meeting.owner_id
      });

      socket.to(roomKey).emit("meeting:peer-joined", serializePresenceItem(presence));

      io.to(roomKey).emit("meeting:chat", {
        id: `${socket.id}-joined`,
        type: "system",
        message: `${user.fullName} joined the meeting.`,
        createdAt: new Date().toISOString()
      });

      emitRoster(io, roomKey);

      io.to(roomKey).emit("meeting:ownerPrompt", {
        type: "join",
        createdAt: new Date().toISOString(),
        ownerId: meeting.owner_id,
        member: user
      });
    } catch (error) {
      socket.emit("meeting:error", { message: "Unable to join meeting right now." });
    }
  });

  socket.on("meeting:sendMessage", ({ identifier, message, user }) => {
    const roomKey = `meeting:${identifier}`;
    io.to(roomKey).emit("meeting:chat", {
      id: `${socket.id}-${Date.now()}`,
      type: "message",
      message,
      createdAt: new Date().toISOString(),
      sender: user
    });
  });

  socket.on("webrtc:offer", ({ target, offer, caller }) => {
    io.to(target).emit("webrtc:offer", {
      source: socket.id,
      offer,
      caller
    });
  });

  socket.on("webrtc:answer", ({ target, answer, responder }) => {
    io.to(target).emit("webrtc:answer", {
      source: socket.id,
      answer,
      responder
    });
  });

  socket.on("webrtc:ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("webrtc:ice-candidate", {
      source: socket.id,
      candidate
    });
  });

  socket.on("whiteboard:permission", ({ canGuestsDraw }) => {
    const presence = socketToPresence.get(socket.id);
    if (!presence || presence.user.id !== presence.meetingOwnerId) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    whiteboard.canGuestsDraw = Boolean(canGuestsDraw);

    io.to(presence.roomKey).emit("whiteboard:permission", {
      canGuestsDraw: whiteboard.canGuestsDraw,
      ownerId: presence.meetingOwnerId
    });
  });

  socket.on("whiteboard:toggle-visible", ({ visible }) => {
    const presence = socketToPresence.get(socket.id);
    if (!presence || presence.user.id !== presence.meetingOwnerId) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    whiteboard.visible = Boolean(visible);

    io.to(presence.roomKey).emit("whiteboard:visibility", {
      visible: whiteboard.visible,
      ownerId: presence.meetingOwnerId
    });
  });

  socket.on("whiteboard:request-open", () => {
    const presence = socketToPresence.get(socket.id);
    if (!presence || presence.user.id === presence.meetingOwnerId) {
      return;
    }

    io.to(presence.roomKey).emit("whiteboard:request-open", {
      requester: presence.user,
      ownerId: presence.meetingOwnerId,
      createdAt: new Date().toISOString()
    });

    io.to(presence.roomKey).emit("meeting:ownerPrompt", {
      type: "whiteboard-request",
      createdAt: new Date().toISOString(),
      ownerId: presence.meetingOwnerId,
      member: presence.user
    });
  });

  socket.on("whiteboard:approve-request", ({ requesterId }) => {
    const presence = socketToPresence.get(socket.id);
    if (!presence || presence.user.id !== presence.meetingOwnerId) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    whiteboard.visible = true;

    io.to(presence.roomKey).emit("whiteboard:visibility", {
      visible: true,
      ownerId: presence.meetingOwnerId,
      approvedRequesterId: requesterId ?? null
    });
  });

  socket.on("whiteboard:clear", () => {
    const presence = socketToPresence.get(socket.id);
    if (!presence || presence.user.id !== presence.meetingOwnerId) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    whiteboard.strokes = [];
    io.to(presence.roomKey).emit("whiteboard:clear");
  });

  socket.on("whiteboard:stroke-start", ({ stroke }) => {
    const presence = socketToPresence.get(socket.id);
    if (!canDraw(presence) || !stroke?.id) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    const nextStroke = {
      id: stroke.id,
      authorId: presence.user.id,
      authorName: presence.user.fullName,
      color: stroke.color || "#1c2340",
      size: Number(stroke.size || 3),
      points: Array.isArray(stroke.points) ? stroke.points.slice(0, 1) : [],
      completed: false
    };

    whiteboard.strokes.push(nextStroke);
    socket.to(presence.roomKey).emit("whiteboard:stroke-start", { stroke: nextStroke });
  });

  socket.on("whiteboard:stroke-point", ({ strokeId, point }) => {
    const presence = socketToPresence.get(socket.id);
    if (!canDraw(presence) || !strokeId || !point) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    const stroke = whiteboard.strokes.find((item) => item.id === strokeId);
    if (!stroke) {
      return;
    }

    stroke.points.push(point);
    socket.to(presence.roomKey).emit("whiteboard:stroke-point", { strokeId, point });
  });

  socket.on("whiteboard:stroke-end", ({ strokeId }) => {
    const presence = socketToPresence.get(socket.id);
    if (!canDraw(presence) || !strokeId) {
      return;
    }

    const whiteboard = getWhiteboard(presence.roomKey);
    const stroke = whiteboard.strokes.find((item) => item.id === strokeId);
    if (!stroke) {
      return;
    }

    stroke.completed = true;
    socket.to(presence.roomKey).emit("whiteboard:stroke-end", { strokeId });
  });

  socket.on("meeting:leave", async () => {
    const presence = socketToPresence.get(socket.id);
    if (!presence) {
      return;
    }

    socket.leave(presence.roomKey);
    socketToPresence.delete(socket.id);

    const participants = presenceByMeeting.get(presence.roomKey);
    if (participants) {
      participants.delete(socket.id);
      if (!participants.size) {
        presenceByMeeting.delete(presence.roomKey);
        whiteboardsByMeeting.delete(presence.roomKey);
      }
    }

    await markLeft(presence.meetingDbId, presence.user.id);

    io.to(presence.roomKey).emit("meeting:peer-left", {
      socketId: socket.id,
      user: presence.user
    });

    io.to(presence.roomKey).emit("meeting:chat", {
      id: `${socket.id}-left`,
      type: "system",
      message: `${presence.user.fullName} left the meeting.`,
      createdAt: new Date().toISOString()
    });

    emitRoster(io, presence.roomKey);

    io.to(presence.roomKey).emit("meeting:ownerPrompt", {
      type: "leave",
      createdAt: new Date().toISOString(),
      ownerId: presence.meetingOwnerId,
      member: presence.user
    });
  });

  socket.on("disconnect", async () => {
    const presence = socketToPresence.get(socket.id);
    if (!presence) {
      return;
    }

    socketToPresence.delete(socket.id);

    const participants = presenceByMeeting.get(presence.roomKey);
    if (participants) {
      participants.delete(socket.id);
      if (!participants.size) {
        presenceByMeeting.delete(presence.roomKey);
        whiteboardsByMeeting.delete(presence.roomKey);
      }
    }

    await markLeft(presence.meetingDbId, presence.user.id);
    io.to(presence.roomKey).emit("meeting:peer-left", {
      socketId: socket.id,
      user: presence.user
    });
    emitRoster(io, presence.roomKey);

    io.to(presence.roomKey).emit("meeting:ownerPrompt", {
      type: "leave",
      createdAt: new Date().toISOString(),
      ownerId: presence.meetingOwnerId,
      member: presence.user
    });
  });
}
