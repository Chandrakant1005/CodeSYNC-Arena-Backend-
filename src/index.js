import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/authRoutes.js";
import meetingRoutes from "./routes/meetingRoutes.js";
import { registerMeetingSocket } from "./socket/presence.js";
import { initializeDatabase } from "./config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, "../../.env");
const serverEnvPath = path.resolve(__dirname, "../.env");

dotenv.config({ path: rootEnvPath });
dotenv.config({ path: serverEnvPath });
dotenv.config();

const app = express();
const server = http.createServer(app);
const clientDistPath = path.resolve(__dirname, "../../client/dist");

const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ||
  process.env.CLIENT_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsOriginHandler(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true
  })
);
app.use(express.json());
app.use(
  session({
    name: "meeting.sid",
    secret: process.env.SESSION_SECRET || "change_this_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);

app.use(express.static(clientDistPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    next();
    return;
  }

  res.sendFile(path.join(clientDistPath, "index.html"));
});

const io = new Server(server, {
  cors: {
    origin: corsOriginHandler,
    credentials: true
  }
});

io.on("connection", (socket) => {
  registerMeetingSocket(io, socket);
});

const port = Number(process.env.PORT || 5000);

initializeDatabase()
  .then(() => {
    console.log("Database ready");
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
