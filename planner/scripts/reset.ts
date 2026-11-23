import "./load-env";
import { Pool } from "pg";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
console.log("✓ database reset");
await pool.end();
