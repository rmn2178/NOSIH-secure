import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { supabase } from "../supabase.js";

dotenv.config();

const BCRYPT_ROUNDS = 12;

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required in backend/.env");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (!existing) {
    const { error } = await supabase.from("users").insert({
      email,
      password_hash: passwordHash,
      role: "admin",
      active: true,
      organization_name: "NOSIH",
    });
    if (error) throw new Error(error.message);
    console.log(`Created admin user: ${email}`);
  } else {
    const { error } = await supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        role: "admin",
        active: true,
        organization_name: existing.organization_name || "NOSIH",
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    console.log(`Updated admin user: ${email}`);
  }
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin seed failed:", error.message);
    process.exit(1);
  });
