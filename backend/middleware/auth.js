import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// JWT_SECRET is audited by envCheck.js. The server keeps running when it is
// missing and answers with a readable error, instead of exiting at import
// time — which on Vercel shows up as FUNCTION_INVOCATION_FAILED on every
// route with no hint about the cause.

export function protect(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "Server misconfigured: JWT_SECRET is not set" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function adminOnly(req, res, next) {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
