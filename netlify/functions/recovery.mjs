import {
  players, fail, json, hashPin, userOut, readBody, currentUser, checkPin, setupError,
  cleanEmail, maskEmail, mailer, newCode, codeHash, sameHex,
  CODE_TTL_MS, CODE_GAP_MS, CODE_DAY_MAX, CODE_TRIES, NAME_RE, PIN_RE,
} from "../lib/core.mjs";

// Add, change or remove the recovery email. Needs the signed-in session and the current PIN.
async function setEmail(req) {
  const me = await currentUser(req);
  if (me.error) return fail(401, me.error);
  const { pin = "", email = "" } = await readBody(req);
  const mail = cleanEmail(email);
  if (mail === null) return fail(400, "That email address does not look right");
  if (!PIN_RE.test(String(pin))) return fail(400, "Enter your 6-digit PIN to confirm");
  const bad = await checkPin(me.key, me.user, String(pin), "That PIN is wrong");
  if (bad) return bad;
  me.user.email = mail || null;
  await players().setJSON(me.key, me.user);
  return json(200, { email: maskEmail(me.user.email) });
}

// Forgot PIN: email a six digit code to the address saved on the account.
// The answer is the same whether or not the name exists or has an email, so nobody can use this to find out.
async function forgot(req) {
  const { username = "" } = await readBody(req);
  if (!NAME_RE.test(String(username))) return fail(400, "Enter your username");
  if (!mailer.enabled()) return fail(503, "PIN recovery is not switched on yet");
  const generic = json(200, { ok: true, message: "If that username has an email saved, a code is on its way. Check your inbox and spam." });
  const key = String(username).toLowerCase();
  const user = await players().get(key, { type: "json" });
  if (!user || !user.email) return generic;
  const now = Date.now(), r = user.reset || {};
  const day = Math.floor(now / 86_400_000);
  const sentToday = r.day === day ? r.sentToday || 0 : 0;
  if (now - (r.sentAt || 0) < CODE_GAP_MS) return fail(429, "A code was just sent. Wait a minute before asking for another");
  if (sentToday >= CODE_DAY_MAX) return fail(429, "Too many codes today. Try again tomorrow");
  const code = newCode();
  const reset = { hash: codeHash(key, code), exp: now + CODE_TTL_MS, tries: 0, sentAt: now, day, sentToday: sentToday + 1 };
  await players().setJSON(key, { ...user, reset });
  try {
    await mailer.send({
      to: user.email,
      subject: "Your Vertical Limit PIN reset code",
      text: `Your code to reset the PIN for ${user.username} is ${code}.\n\nIt works for 15 minutes. If you did not ask for this, you can ignore this email and nothing will change.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111"><p>Your code to reset the PIN for <b>${user.username}</b> is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p><p>It works for 15 minutes. If you did not ask for this, you can ignore this email and nothing will change.</p><p style="color:#666;font-size:13px">Vertical Limit</p></div>`,
    });
  } catch (err) {
    console.error("reset email failed", err);
    await players().setJSON(key, { ...user, reset: { ...reset, hash: null } });
    return fail(502, "The email could not be sent. Try again in a minute");
  }
  return generic;
}

// Reset: the emailed code plus a new PIN. Signs the player straight in and signs every other device out.
async function reset(req) {
  const { username = "", code = "", pin = "" } = await readBody(req);
  if (!NAME_RE.test(String(username))) return fail(400, "Enter your username");
  if (!/^\d{6}$/.test(String(code).trim())) return fail(400, "The code is the 6 digits in the email");
  if (!PIN_RE.test(String(pin))) return fail(400, "New PIN must be exactly 6 digits");
  const key = String(username).toLowerCase();
  const user = await players().get(key, { type: "json" });
  const r = user && user.reset;
  const wrong = fail(403, "That code is not right or has expired. Ask for a new one");
  if (!r || !r.hash || r.exp < Date.now()) return wrong;
  if ((r.tries || 0) >= CODE_TRIES) return fail(429, "Too many wrong codes. Ask for a new one");
  if (!sameHex(r.hash, codeHash(key, String(code).trim()))) {
    await players().setJSON(key, { ...user, reset: { ...r, tries: (r.tries || 0) + 1 } });
    return wrong;
  }
  Object.assign(user, hashPin(String(pin)), { tv: (user.tv || 0) + 1, fails: 0, lockUntil: 0, reset: { sentAt: r.sentAt, day: r.day, sentToday: r.sentToday } });
  await players().setJSON(key, user);
  return json(200, userOut(key, user));
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Use POST");
  const notReady = setupError();
  if (notReady) return notReady;
  const path = new URL(req.url).pathname;
  if (path.endsWith("/set-email")) return setEmail(req);
  if (path.endsWith("/forgot")) return forgot(req);
  if (path.endsWith("/reset")) return reset(req);
  return fail(404, "Not found");
};

export const config = { path: ["/api/auth/set-email", "/api/auth/forgot", "/api/auth/reset"] };
