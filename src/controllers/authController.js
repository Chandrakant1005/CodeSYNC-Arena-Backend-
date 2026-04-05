import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function getDatabaseErrorMessage(error) {
  switch (error?.code) {
    case "ER_ACCESS_DENIED_ERROR":
      return "MySQL username or password is incorrect. Update your .env database settings.";
    case "ER_BAD_DB_ERROR":
      return "The MySQL database does not exist. Check MYSQL_DATABASE in .env.";
    case "ER_NO_SUCH_TABLE":
      return "Database tables are missing. Restart the backend so it can initialize the schema.";
    case "ECONNREFUSED":
      return "MySQL is not running on the configured host and port.";
    default:
      return "Unable to create account right now.";
  }
}

export async function signup(req, res) {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }

  try {
    const [existingUsers] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUsers.length) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)",
      [fullName, email, passwordHash]
    );

    req.session.userId = result.insertId;

    return res.status(201).json({
      token: signToken(result.insertId),
      user: {
        id: result.insertId,
        fullName,
        email
      }
    });
  } catch (error) {
    console.error("Signup failed:", error);
    return res.status(500).json({ message: getDatabaseErrorMessage(error) });
  }
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!rows.length) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    req.session.userId = user.id;

    return res.json({
      token: signToken(user.id),
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ message: getDatabaseErrorMessage(error) });
  }
}

export async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ message: "User not authenticated." });
  }

  return res.json({ user: req.user });
}

export function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie("meeting.sid");
    res.json({ message: "Logged out successfully." });
  });
}
