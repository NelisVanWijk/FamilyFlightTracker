import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "./db.js";

const jwtSecret = () => process.env.JWT_SECRET || "dev-secret-change-me";

export const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(200)
});

export const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

export function signUser(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    jwtSecret(),
    { expiresIn: "14d" }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Niet ingelogd." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret());
    const { rows } = await query("select id, email, name, role from users where id = $1", [payload.sub]);
    if (!rows[0]) {
      return res.status(401).json({ error: "Gebruiker bestaat niet meer." });
    }
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: "Sessie is verlopen." });
  }
}

export async function createUser(input) {
  const parsed = registerSchema.parse(input);
  const hash = await bcrypt.hash(parsed.password, 12);
  const { rows } = await query(
    `insert into users (email, name, password_hash)
     values ($1, $2, $3)
     returning id, email, name, role`,
    [parsed.email, parsed.name, hash]
  );
  return rows[0];
}

export async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !password) {
    return null;
  }

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD moet minimaal 8 tekens zijn.");
  }

  const existing = await query("select id, email, name, role from users where email = $1", [email]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `insert into users (email, name, password_hash, role)
     values ($1, $2, $3, 'admin')
     returning id, email, name, role`,
    [email, name, hash]
  );
  return rows[0];
}

export async function registrationAllowed() {
  if ((process.env.ALLOW_REGISTRATION || "").toLowerCase() === "true") {
    return true;
  }

  const { rows } = await query("select count(*)::int as count from users");
  return rows[0].count === 0;
}

export async function verifyLogin(input) {
  const parsed = loginSchema.parse(input);
  const { rows } = await query("select * from users where email = $1", [parsed.email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(parsed.password, user.password_hash))) {
    return null;
  }
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
