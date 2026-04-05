import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token is missing." });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.query(
      "SELECT id, full_name, email, created_at FROM users WHERE id = ?",
      [decoded.userId]
    );

    if (!rows.length) {
      return res.status(401).json({ message: "User session is no longer valid." });
    }

    req.user = {
      id: rows[0].id,
      fullName: rows[0].full_name,
      email: rows[0].email,
      createdAt: rows[0].created_at
    };

    req.session.userId = rows[0].id;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired session." });
  }
}
