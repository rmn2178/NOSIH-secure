import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { supabase, userFromRow, isUniqueViolation } from "../supabase.js";
import { protect, adminOnly } from "../middleware/auth.js";
import dotenv from "dotenv";
dotenv.config();

const router = Router();
const BCRYPT_ROUNDS = 12;

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", String(email).toLowerCase())
    .eq("active", true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  res.json({ token, user: userFromRow(user) });
});

// POST /api/auth/register  (admin only — creates new issuer accounts)
router.post("/register", protect, adminOnly, async (req, res) => {
  const { email, password, walletAddress, organizationName, role } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const normalizedEmail = String(email).toLowerCase();

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existing)
    return res.status(409).json({ error: "Email already registered" });

  const { data: user, error } = await supabase
    .from("users")
    .insert({
      email: normalizedEmail,
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      wallet_address: walletAddress?.toLowerCase(),
      organization_name: organizationName,
      role: role === "admin" ? "admin" : "issuer",
    })
    .select("id")
    .single();

  if (error) {
    const status = isUniqueViolation(error) ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }

  res.status(201).json({ message: "Issuer account created", userId: user.id });
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", req.userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(userFromRow(user));
});

export default router;
