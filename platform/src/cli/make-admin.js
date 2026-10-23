// Usage: npm run make-admin -- someone@example.com
import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run make-admin -- <email>'); process.exit(1); }
const db = openDatabase(loadConfig().dataDir);
const r = db.run("UPDATE users SET role = 'admin' WHERE email = ?", email);
console.log(r.changes ? `${email} is now an administrator.` : `No account found for ${email}. Sign up first.`);
db.close();
