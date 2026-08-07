import { z } from 'zod';

// Env booleans arrive as strings ("true"/"1"). Coerce leniently; unset -> default.
const envBool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? def : v === 'true' || v === '1',
    );

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  DB_PATH: z.string().default('../../data/db.sqlite'),
  NOTES_DIR: z.string().default('../../data/notes'),
  CONFIGS_DIR: z.string().default('../../data/configs'),
  // When set (prod image), Nest serves the built frontend from this dir on
  // the same port as the API. Unset in dev — Vite serves the frontend.
  STATIC_ROOT: z.string().optional(),
  // --- Auth (Brief 10) ---------------------------------------------------
  // Forces the session cookie Secure. Leave false for plain-HTTP LAN use;
  // set true to require Secure even for requests the server sees as http.
  // Note: the cookie is ALSO marked Secure automatically whenever the request
  // arrives over HTTPS (req.secure, which honours X-Forwarded-Proto once
  // TRUST_PROXY is on) — so behind a TLS proxy you get Secure cookies without
  // flipping this. Browsers drop Secure cookies over http://, hence the default.
  COOKIE_SECURE: envBool(false),
  // Trust X-Forwarded-* from a front proxy so req.ip / protocol are real
  // (needed for correct rate-limit keying and secure-cookie behaviour behind
  // Caddy/nginx). Keep false when exposed directly.
  TRUST_PROXY: envBool(false),
  // Session lifetime. Sliding (brief 101): the HTTP guard extends expiry on
  // authed activity, capped by SESSION_ABSOLUTE_MAX_HOURS below. Plain
  // validation (the pty sweep, WS upgrades) never renews — see
  // SessionService.renewIfDue for why that separation is load-bearing.
  SESSION_TTL_HOURS: z.coerce.number().default(168), // 7 days
  // Hard ceiling on any one session, measured from login. Sliding without a
  // cap means a stolen cookie never expires. Values below SESSION_TTL_HOURS
  // are clamped up to it at use time rather than rejected here.
  SESSION_ABSOLUTE_MAX_HOURS: z.coerce.number().default(720), // 30 days
  // --- First-run claim protection (Brief 28) -----------------------------
  // Set to a random secret (printed to your deploy logs / passed to the
  // operator) to require it at first-run setup; leave unset for trusted
  // networks. When set, POST /auth/setup must present a matching token or is
  // rejected; when unset, first-run behaviour is exactly as before.
  SETUP_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
