import { players, fail, json, hashPin, userOut, readBody, currentUser, checkPin, setupError, cleanEmail, NAME_RE, PIN_RE } from "../lib/core.mjs";

async function changePin(req) {
  const me = await currentUser(req);
  if (me.error) return fail(401, me.error);
  const { pin = "", new_pin = "" } = await readBody(req);
  if (!PIN_RE.test(new_pin)) return fail(400, "New PIN must be exactly 6 digits");
  if (new_pin === String(pin)) return fail(400, "New PIN must be different");
  const bad = await checkPin(me.key, me.user, String(pin), "Current PIN is wrong");
  if (bad) return bad;
  Object.assign(me.user, hashPin(new_pin), { tv: (me.user.tv || 0) + 1 });
  await players().setJSON(me.key, me.user);
  return json(200, userOut(me.key, me.user));
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Use POST");
  const notReady = setupError();
  if (notReady) return notReady;
  const path = new URL(req.url).pathname;
  if (path.endsWith("/change-pin")) return changePin(req);
  const action = path.endsWith("/register") ? "register" : "login";
  const { username = "", pin = "", email = "" } = await readBody(req);
  if (!NAME_RE.test(username)) return fail(400, "Username must be 3-16 letters, numbers or _");
  if (!PIN_RE.test(pin)) return fail(400, "PIN must be exactly 6 digits");
  const mail = action === "register" ? cleanEmail(email) : "";
  if (mail === null) return fail(400, "That email address does not look right");
  const key = username.toLowerCase();
  const store = players();
  const user = await store.get(key, { type: "json" });

  if (action === "register") {
    if (user) return fail(409, "That username is taken");
    const fresh = { username, ...hashPin(pin), games: {}, fails: 0, lockUntil: 0, createdAt: new Date().toISOString(), email: mail || null };
    await store.setJSON(key, fresh);
    return json(201, userOut(key, fresh));
  }

  if (!user) return fail(401, "Wrong username or PIN");
  const bad = await checkPin(key, user, pin, "Wrong username or PIN");
  if (bad) return bad;
  return json(200, userOut(key, user));
};

export const config = { path: ["/api/auth/login", "/api/auth/register", "/api/auth/change-pin"] };
