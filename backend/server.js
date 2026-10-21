/* ================================================================
   MatAi 2027 — Express backend + Admin API
   - Serves the static site
   - Receives public form submissions  (POST /api/:kind)
   - Serves editable site content       (GET  /api/content)
   - Password-protected admin panel API (/admin/**)

   SECURITY: Submissions contain personal data (PII). There is NO
   public read endpoint. Private storage is outside the static frontend,
   and every /admin/api/** route requires an authenticated
   session (login with ADMIN_USERNAME + NODE_ADMIN_PASSWORD_HASH). Do not weaken these controls.
   ================================================================ */
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const multer = require("multer");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const storage = require("./storage");
const { applyVerifiedPaymentStatus } = require("./payment-status");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const FRONTEND_DIR = path.join(ROOT, "..", "frontend");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const IMAGE_UPLOAD_DIR = path.join(DATA_DIR, "images");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_MODE = process.env.PAYPAL_MODE === "live" ? "live" : "sandbox";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const RAZORPAY_CURRENCY = "EUR";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT).replace(/\/+$/, "");
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || "local";
const SECURE_COOKIES = APP_ENV === "production" || PUBLIC_BASE_URL.startsWith("https://");
const NODE_ADMIN_PASSWORD_HASH = process.env.NODE_ADMIN_PASSWORD_HASH || "";
const { verifyAdminPassword, safeEqual, sessionCookie } = require("./admin-auth");
const { createCsrfProtection } = require("./csrf-protection");

if (APP_ENV === "production" && !PUBLIC_BASE_URL.startsWith("https://")) {
  throw new Error("PUBLIC_BASE_URL must use HTTPS when the Node application is in production.");
}

// Allowed form kinds -> required fields (server-side validation)
const FORMS = {
  abstract: ["title", "authorName", "email", "institution", "country", "session", "abstract"],
  register: ["fullName", "email", "period", "institution", "country"],
  contact:  ["fullName", "email", "subject", "message"],
  brochure: ["fullName", "email"]
};
const KINDS = ["register", "abstract", "contact", "brochure"];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });

const ABSTRACT_UPLOAD_TYPES = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".doc": ["application/msword", "application/octet-stream"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"]
};
const abstractUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, crypto.randomBytes(24).toString("hex") + extension);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20, fieldSize: 10000 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const acceptedTypes = ABSTRACT_UPLOAD_TYPES[extension];
    if (!acceptedTypes || !acceptedTypes.includes(file.mimetype)) {
      return callback(new Error("Upload a PDF or Word document (.pdf, .doc, .docx)."));
    }
    callback(null, true);
  }
});
const IMAGE_UPLOAD_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, IMAGE_UPLOAD_DIR),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, crypto.randomBytes(24).toString("hex") + extension);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (IMAGE_UPLOAD_TYPES[extension] !== file.mimetype) {
      return callback(new Error("Upload a JPEG, PNG, GIF, or WebP image."));
    }
    callback(null, true);
  }
});

async function hasValidImageSignature(file) {
  const handle = await fsp.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(12);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const signature = buffer.subarray(0, result.bytesRead);
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    if (extension === ".png") return signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (extension === ".gif") return signature.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
    if (extension === ".webp") return signature.subarray(0, 4).toString("ascii") === "RIFF" && signature.subarray(8, 12).toString("ascii") === "WEBP";
    return false;
  } finally {
    await handle.close();
  }
}

function parseAbstractUpload(req, res, next) {
  if (req.params.kind !== "abstract") return next();
  abstractUpload.single("attachment")(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
    const message = tooLarge
      ? "The abstract document must be 5 MB or smaller."
      : err instanceof multer.MulterError
        ? "Upload one PDF or Word document only."
        : err.message;
    res.status(tooLarge ? 413 : 400).json({ ok: false, error: message });
  });
}

async function removeUploadedFile(file) {
  if (!file) return;
  try {
    await fsp.unlink(file.path);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Could not remove abstract upload:", err);
  }
}

async function hasValidAbstractSignature(file) {
  const handle = await fsp.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(8);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const signature = buffer.subarray(0, result.bytesRead);
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension === ".pdf") return signature.subarray(0, 5).toString() === "%PDF-";
    if (extension === ".doc") return signature.subarray(0, 8).equals(Buffer.from("D0CF11E0A1B11AE1", "hex"));
    return extension === ".docx" && signature.subarray(0, 4).equals(Buffer.from("504B0304", "hex"));
  } finally {
    await handle.close();
  }
}

function safeUploadName(originalName) {
  return String(originalName || "abstract-document")
    .replace(/[\\/]/g, "/").split("/").pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "abstract-document";
}

/* ---------- Editable site content (CMS) ---------- */
const DEFAULT_CONTENT = {
  banner: {
    enabled: true,
    text: "Abstract submissions for MatAi 2027 are now open. Register early to secure Early-Bird rates."
  },
  site: {
    theme: "Advancing Materials Innovation through Science, Engineering & Artificial Intelligence",
    dateText: "October 13–14, 2027",
    city: "Berlin, Germany"
  },
  dates: [
    { label: "Abstract Submission Opens", value: "To Be Announced" },
    { label: "Abstract Submission Deadline", value: "To Be Announced" },
    { label: "Early-Bird Registration Deadline", value: "To Be Announced" },
    { label: "Conference Dates", value: "October 13–14, 2027" }
  ],
  fees: {
    "Early Bird": { Speaker: 649, Delegate: 749, Poster: 549, Student: 399, Virtual: 299 },
    "Mid-Term":   { Speaker: 749, Delegate: 849, Poster: 649, Student: 499, Virtual: 399 },
    "On-Spot":    { Speaker: 849, Delegate: 949, Poster: 749, Student: 599, Virtual: 499 }
  },
  registrationPeriods: {
    active: "Early Bird",
    "Early Bird": { label: "Early Bird Registration", deadline: "To Be Announced" },
    "Mid-Term": { label: "Mid Term Registration", deadline: "To Be Announced" },
    "On-Spot": { label: "Late Registration", deadline: "To Be Announced" }
  },
  registrationPricing: {
    fixedItems: {
      exhibition_standard: 3500,
      exhibition_premium: 4500,
      exhibition_startup: 1500,
      sponsor_diamond: 10000,
      sponsor_platinum: 7500,
      sponsor_gold: 4500,
      sponsor_silver: 2000,
      sponsor_bronze: 1500,
      sponsor_keynote: 1500,
      sponsor_plenary: 1500,
      sponsor_advertising: 1500,
      sponsor_coffee: 1500,
      sponsor_lunch: 2500,
      sponsor_reception: 3500,
      sponsor_kit: 2000,
      sponsor_lanyard: 1500,
      sponsor_awards: 2000,
      sponsor_insert: 500,
      sponsor_industry: 1500,
      addon_social: 149,
      addon_accompanying: 200,
      addon_accommodation_single: 180,
      addon_accommodation_double: 195
    }
  },
  coupons: [],
  pages: {},
  committee: [],
  speakers: []
};
function mergeDefaults(defaults, saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return JSON.parse(JSON.stringify(defaults));
  const merged = Object.assign({}, defaults);
  Object.keys(saved).forEach((key) => {
    const base = defaults[key];
    const value = saved[key];
    merged[key] = base && value && typeof base === "object" && typeof value === "object" &&
      !Array.isArray(base) && !Array.isArray(value)
      ? mergeDefaults(base, value)
      : value;
  });
  return merged;
}
/* ---------- Middleware ---------- */
// Provider webhooks above authenticate with provider signatures and intentionally bypass browser CSRF tokens.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    await processStripeWebhook(req.body, req.get("stripe-signature"));
    res.json({ received: true });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ ok: false, error: err.message });
    console.error("Stripe webhook processing failed:", err);
    res.status(500).json({ ok: false, error: "Could not process payment notification." });
  }
});
app.post("/api/razorpay/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    await processRazorpayWebhook(req.body, req.get("x-razorpay-signature"));
    res.json({ received: true });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ ok: false, error: err.message });
    console.error("Razorpay webhook processing failed:", err);
    res.status(500).json({ ok: false, error: "Could not process payment notification." });
  }
});
app.use(express.json({ limit: "256kb" }));

// Block public access to stored submissions (PII) and server internals.
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p === "/data" || p.startsWith("/data/") ||
      p === "/server.js" || p === "/package.json" || p === "/package-lock.json" ||
      p.startsWith("/node_modules")) {
    return res.status(404).send("Not found");
  }
  next();
});

/* ---------- Session auth (in-memory) ---------- */
const sessions = new Map(); // token -> session state
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 hours
function newSession(authenticated) {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) sessions.delete(token);
  });
  const t = crypto.randomBytes(24).toString("hex");
  sessions.set(t, {
    expiresAt: now + SESSION_TTL,
    csrf: crypto.randomBytes(32).toString("hex"),
    authenticated: Boolean(authenticated)
  });
  return t;
}
function getSession(req) {
  const token = parseCookies(req).matai_admin;
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie; if (!h) return out;
  h.split(";").forEach(function (c) {
    const i = c.indexOf("=");
    if (i > -1) {
      const name = c.slice(0, i).trim();
      try { out[name] = decodeURIComponent(c.slice(i + 1).trim()); }
      catch (_) { out[name] = ""; }
    }
  });
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", sessionCookie(token, SECURE_COOKIES, SESSION_TTL / 1000));
}
function isAuthed(req) {
  const current = getSession(req);
  return Boolean(current && current.session.authenticated);
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

app.get("/api/csrf", (req, res) => {
  let current = getSession(req);
  if (!current) {
    const token = newSession(false);
    current = { token, session: sessions.get(token) };
    setSessionCookie(res, token);
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, token: current.session.csrf });
});

app.use(createCsrfProtection(getSession));

/* ---------- Auth endpoints ---------- */
app.post("/admin/login", (req, res) => {
  if (!ADMIN_USERNAME || !NODE_ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ ok: false, error: "Administrator credentials are not configured." });
  }
  const user = String((req.body && req.body.username) || "");
  const pw = String((req.body && req.body.password) || "");
  const current = getSession(req);
  const userOk = safeEqual(user, ADMIN_USERNAME);
  const passOk = verifyAdminPassword(pw, NODE_ADMIN_PASSWORD_HASH);
  if (!userOk || !passOk) return res.status(401).json({ ok: false, error: "Incorrect username or password." });
  if (current) sessions.delete(current.token);
  const token = newSession(true);
  setSessionCookie(res, token);
  res.json({ ok: true, csrf: sessions.get(token).csrf });
});
app.post("/admin/logout", (req, res) => {
  const c = parseCookies(req);
  if (c.matai_admin) sessions.delete(c.matai_admin);
  res.setHeader("Set-Cookie", sessionCookie("", SECURE_COOKIES, 0));
  res.json({ ok: true });
});
app.get("/admin/api/session", (req, res) => {
  const current = getSession(req);
  res.json({
    ok: true,
    authed: Boolean(current && current.session.authenticated),
    username: current && current.session.authenticated ? ADMIN_USERNAME : "",
    csrf: current ? current.session.csrf : ""
  });
});

/* ---------- Public content ---------- */
app.get("/api/content", async (_req, res) => {
  try {
    res.json({ ok: true, content: mergeDefaults(DEFAULT_CONTENT, await storage.loadContent()) });
  } catch (err) {
    console.error("Failed to read site content:", err);
    res.status(500).json({ ok: false, error: "Could not load website content." });
  }
});

/* ---------- Helpers ---------- */
function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function sanitize(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (typeof v === "string") out[k] = v.slice(0, 5000);
    else if (typeof v === "boolean" || typeof v === "number") out[k] = v;
  }
  return out;
}
const REGISTRATION_ITEMS = [
  { field: "qty_speaker", label: "Speaker Registration", category: "Speaker" },
  { field: "qty_delegate", label: "Delegate Registration", category: "Delegate" },
  { field: "qty_poster", label: "Poster Presentation", category: "Poster" },
  { field: "qty_student", label: "Student Registration", category: "Student" },
  { field: "qty_virtual", label: "Virtual Registration", category: "Virtual" },
  { field: "qty_ex_standard", label: "Standard Exhibition Booth (3 x 2 m)", fixed: "exhibition_standard" },
  { field: "qty_ex_premium", label: "Premium Exhibition Booth (3 x 3 m)", fixed: "exhibition_premium" },
  { field: "qty_ex_startup", label: "Start-Up Pavilion", fixed: "exhibition_startup" },
  { field: "qty_sp_diamond", label: "Diamond Sponsor", fixed: "sponsor_diamond" },
  { field: "qty_sp_platinum", label: "Platinum Sponsor", fixed: "sponsor_platinum" },
  { field: "qty_sp_gold", label: "Gold Sponsor", fixed: "sponsor_gold" },
  { field: "qty_sp_silver", label: "Silver Sponsor", fixed: "sponsor_silver" },
  { field: "qty_sp_bronze", label: "Bronze / Supporting Sponsor", fixed: "sponsor_bronze" },
  { field: "qty_ss_keynote", label: "Keynote Session Sponsor", fixed: "sponsor_keynote" },
  { field: "qty_ss_plenary", label: "Plenary Session Sponsor", fixed: "sponsor_plenary" },
  { field: "qty_ss_advertising", label: "Advertising Sponsor", fixed: "sponsor_advertising" },
  { field: "qty_ss_coffee", label: "Coffee Break Sponsor", fixed: "sponsor_coffee" },
  { field: "qty_ss_lunch", label: "Lunch Sponsor (per day)", fixed: "sponsor_lunch" },
  { field: "qty_ss_reception", label: "Conference Reception Sponsor", fixed: "sponsor_reception" },
  { field: "qty_ss_kit", label: "Conference Kit Sponsor", fixed: "sponsor_kit" },
  { field: "qty_ss_lanyard", label: "Lanyard & Badge Sponsor", fixed: "sponsor_lanyard" },
  { field: "qty_ss_awards", label: "Awards & Young Researcher Sponsor", fixed: "sponsor_awards" },
  { field: "qty_ss_insert", label: "Delegate Kit Insert", fixed: "sponsor_insert" },
  { field: "qty_ss_industry", label: "Industry Presentation", fixed: "sponsor_industry" },
  { field: "qty_social", label: "Social & Networking Event", fixed: "addon_social" },
  { field: "qty_accompanying", label: "Accompanying Person", fixed: "addon_accompanying" },
  { field: "qty_accom_single", label: "Accommodation — Single Occupancy", fixed: "addon_accommodation_single" },
  { field: "qty_accom_double", label: "Accommodation — Double Occupancy", fixed: "addon_accommodation_double" }
];
const REGISTRATION_PERIODS = ["Early Bird", "Mid-Term", "On-Spot"];
function effectiveRegistrationPeriod(periods) {
  let index = REGISTRATION_PERIODS.indexOf(periods && periods.active);
  if (index < 0) index = 0;
  const today = new Date().toISOString().slice(0, 10);
  while (index < REGISTRATION_PERIODS.length - 1) {
    const current = periods && periods[REGISTRATION_PERIODS[index]];
    const deadline = current && current.deadline;
    // A tier remains active through its deadline date, then advances the next day.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || "") || deadline >= today) break;
    index += 1;
  }
  return REGISTRATION_PERIODS[index];
}
async function prepareRegistration(input) {
  const data = Object.assign({}, input);
  const missing = FORMS.register.filter((field) => {
    const value = data[field];
    return value === undefined || (typeof value === "string" && value.trim() === "");
  });
  if (missing.length) {
    const error = new Error("Missing required fields: " + missing.join(", "));
    error.statusCode = 400;
    throw error;
  }
  if (!isEmail(data.email)) {
    const error = new Error("Invalid email address.");
    error.statusCode = 400;
    throw error;
  }
  if (data.terms !== true && data.terms !== "on" && data.terms !== "true") {
    const error = new Error("You must accept the registration terms.");
    error.statusCode = 400;
    throw error;
  }
  const gateway = String(data.paymentGateway || "");
  if (!["Stripe / Card Payment", "PayPal", "Razorpay", "Bank Transfer"].includes(gateway)) {
    const error = new Error("Select a valid payment method.");
    error.statusCode = 400;
    throw error;
  }

  const content = mergeDefaults(DEFAULT_CONTENT, await storage.loadContent());
  const period = effectiveRegistrationPeriod(content.registrationPeriods);
  const items = [];
  let grossCents = 0;
  let participantCount = 0;
  for (const item of REGISTRATION_ITEMS) {
    const rawQuantity = data[item.field] == null || data[item.field] === "" ? "0" : String(data[item.field]);
    if (!/^\d+$/.test(rawQuantity) || Number(rawQuantity) > 100) {
      const error = new Error("Invalid quantity for " + item.label + ".");
      error.statusCode = 400;
      throw error;
    }
    const quantity = Number(rawQuantity);
    if (!quantity) continue;
    let price;
    if (item.fixed) {
      price = Number(content.registrationPricing && content.registrationPricing.fixedItems &&
        content.registrationPricing.fixedItems[item.fixed]);
    } else {
      price = Number(content.fees && content.fees[period] && content.fees[period][item.category]);
    }
    if (!Number.isFinite(price) || price < 0 || price > 1000000) {
      const error = new Error("The configured price for " + item.label + " is invalid.");
      error.statusCode = 500;
      throw error;
    }
    const unitCents = Math.round(price * 100);
    grossCents += unitCents * quantity;
    if (!item.fixed) participantCount += quantity;
    items.push({ name: item.label, category: item.category || "", quantity, unitCents });
  }
  if (!items.length) {
    const error = new Error("Select at least one registration item.");
    error.statusCode = 400;
    throw error;
  }
  if (grossCents <= 0 || grossCents > 99999999) {
    const error = new Error("The registration total must be greater than zero and below €1,000,000.");
    error.statusCode = 400;
    throw error;
  }

  let discountPercent = 0;
  const couponCode = String(data.couponCode || "").trim().toUpperCase();
  if (couponCode) {
    const coupon = (Array.isArray(content.coupons) ? content.coupons : []).find((entry) =>
      entry && entry.enabled !== false && String(entry.code || "").trim().toUpperCase() === couponCode);
    if (!coupon || !Number.isFinite(Number(coupon.percent)) || Number(coupon.percent) <= 0 || Number(coupon.percent) > 100) {
      const error = new Error("The coupon code is invalid or expired.");
      error.statusCode = 400;
      throw error;
    }
    discountPercent = Number(coupon.percent) / 100;
  }
  const discountCents = Math.round(grossCents * discountPercent);
  const subtotalCents = Math.max(0, grossCents - discountCents);
  const validTaxRate = 0.05;
  const taxCents = Math.round(subtotalCents * validTaxRate);
  const totalCents = subtotalCents + taxCents;
  const amount = totalCents / 100;
  data.period = period;
  data.participantCount = participantCount;
  data.category = items.filter((item) => item.category)
    .map((item) => item.name).join(", ") || "Add-ons only";
  data.selectedItems = items.map((item) => item.name + " ×" + item.quantity).join("; ");
  data.totalPrice = amount.toFixed(2);
  data.totalPriceEUR = amount.toFixed(2);
  data.taxRate = validTaxRate;
  data.taxAmount = (taxCents / 100).toFixed(2);
  data.paymentMethod = gateway;
  return { data, items, amount, totalCents, grossCents, discountCents, taxCents, period };
}

async function stripeRequest(endpoint, params, method) {
  const options = {
    method: method || "POST",
    headers: { Authorization: "Bearer " + STRIPE_SECRET_KEY }
  };
  if (params) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  }
  const response = await fetch("https://api.stripe.com/v1/" + endpoint, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error && result.error.message || "Stripe API request failed.");
    error.statusCode = response.status;
    throw error;
  }
  return result;
}

const PAYPAL_API_BASE = PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
async function paypalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PayPal is not configured.");
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET).toString("base64");
  const response = await fetch(PAYPAL_API_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || "PayPal authentication failed.");
  return result.access_token;
}
async function paypalRequest(endpoint, token, body) {
  const options = {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(PAYPAL_API_BASE + endpoint, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "PayPal API request failed.");
  return result;
}
async function razorpayRequest(endpoint, body, method) {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured.");
  const options = {
    method: method || "GET",
    headers: { Authorization: "Basic " + Buffer.from(RAZORPAY_KEY_ID + ":" + RAZORPAY_KEY_SECRET).toString("base64") }
  };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch("https://api.razorpay.com/v1/" + endpoint, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error && result.error.description || "Razorpay API request failed.");
  return result;
}
function constantTimeHexEqual(expectedHex, actualHex) {
  if (typeof actualHex !== "string" || !/^[0-9a-f]+$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET || !Buffer.isBuffer(rawBody) || !signatureHeader) return false;
  let timestamp;
  const signatures = [];
  signatureHeader.split(",").forEach((part) => {
    const pair = part.split("=");
    if (pair.length !== 2) return;
    if (pair[0] === "t") timestamp = pair[1];
    if (pair[0] === "v1") signatures.push(pair[1]);
  });
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300 || !signatures.length) return false;
  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(timestamp + "." + rawBody.toString("utf8")).digest("hex");
  const calculated = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
  });
}

async function applyStripeSession(session, outcome) {
  const reference = session && session.metadata && session.metadata.reference || session && session.client_reference_id;
  if (!reference) return;
  await updateArr("register", async (arr) => {
    const record = arr.find((entry) => entry.reference === reference &&
      entry.stripeCheckoutSessionId === session.id);
    if (!record) return;
    if (outcome === "paid" && session.payment_status === "paid") {
      applyVerifiedPaymentStatus(record, "Paid", {
        stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : ""
      });
    } else if (outcome === "cancelled") {
      applyVerifiedPaymentStatus(record, "Cancelled");
    }
  });
}

async function markRegistrationPaid(reference, providerId, provider, extra) {
  await updateArr("register", async (arr) => {
    const record = arr.find((entry) => entry.reference === reference &&
      entry[provider + "OrderId"] === providerId);
    return applyVerifiedPaymentStatus(record, "Paid", extra);
  });
}

async function processRazorpayWebhook(rawBody, signatureHeader) {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    const error = new Error("Razorpay webhook is not configured.");
    error.statusCode = 400;
    throw error;
  }
  if (!Buffer.isBuffer(rawBody) || !signatureHeader) {
    const error = new Error("Invalid Razorpay webhook signature.");
    error.statusCode = 400;
    throw error;
  }
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  if (!constantTimeHexEqual(expected, signatureHeader)) {
    const error = new Error("Invalid Razorpay webhook signature.");
    error.statusCode = 400;
    throw error;
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (_) {
    const error = new Error("Invalid Razorpay webhook payload.");
    error.statusCode = 400;
    throw error;
  }
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  if (event.event === "payment.captured" && payment && payment.order_id && payment.id) {
    const records = await readArr("register");
    const record = records.find((entry) => entry.razorpayOrderId === payment.order_id);
    if (record && payment.currency === RAZORPAY_CURRENCY &&
        Number(payment.amount) === Math.round(Number(record.amount) * 100)) {
      await markRegistrationPaid(record.reference, payment.order_id, "razorpay", {
        razorpayPaymentId: payment.id
      });
    }
  } else if (event.event === "payment.failed" && payment && payment.order_id) {
    await updateArr("register", async (arr) => {
      const record = arr.find((entry) => entry.razorpayOrderId === payment.order_id);
      applyVerifiedPaymentStatus(record, "Failed");
    });
  }
}

async function processStripeWebhook(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) {
    const error = new Error("Stripe webhook is not configured.");
    error.statusCode = 400;
    throw error;
  }
  if (!verifyStripeSignature(rawBody, signatureHeader)) {
    const error = new Error("Invalid Stripe webhook signature.");
    error.statusCode = 400;
    throw error;
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (_) {
    const error = new Error("Invalid Stripe webhook payload.");
    error.statusCode = 400;
    throw error;
  }
  const session = event.data && event.data.object;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await applyStripeSession(session, "paid");
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await applyStripeSession(session, "cancelled");
  }
}
const readArr = storage.readArr;
const updateArr = storage.updateArr;
function csvCell(v) {
  if (v == null) return "";
  v = String(v);
  if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

/* ---------- Public form submissions ---------- */
app.get("/api/checkout/stripe/config", (_req, res) => {
  res.json({ ok: true, enabled: Boolean(STRIPE_SECRET_KEY), currency: "EUR" });
});
app.get("/api/checkout/config", (_req, res) => {
  res.json({
    ok: true,
    stripe: { enabled: Boolean(STRIPE_SECRET_KEY), currency: "EUR" },
    paypal: { enabled: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET), mode: PAYPAL_MODE, currency: "EUR" },
    razorpay: {
      enabled: Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && /^[A-Z]{3}$/.test(RAZORPAY_CURRENCY)),
      keyId: RAZORPAY_KEY_ID || "",
      currency: RAZORPAY_CURRENCY
    }
  });
});

app.post("/api/checkout/stripe", async (req, res) => {
  if (!STRIPE_SECRET_KEY) {
    return res.status(503).json({ ok: false, error: "Stripe checkout is not configured. Please choose bank transfer or contact the organizers." });
  }
  const input = sanitize(req.body);
  let registration;
  try {
    registration = await prepareRegistration(input);
    if (registration.data.paymentGateway !== "Stripe / Card Payment") {
      return res.status(400).json({ ok: false, error: "Select Stripe / Card Payment to continue to checkout." });
    }
    const baseUrl = new URL(PUBLIC_BASE_URL);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTP or HTTPS.");
    if (STRIPE_SECRET_KEY.startsWith("sk_live_") && baseUrl.protocol !== "https:") {
      throw new Error("Live Stripe checkout requires an HTTPS PUBLIC_BASE_URL.");
    }
  } catch (err) {
    return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
  const reference = "MATAI-" + Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(2).toString("hex").toUpperCase();
  const params = {
    mode: "payment",
    "payment_method_types[0]": "card",
    success_url: PUBLIC_BASE_URL + "/registration.html?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: PUBLIC_BASE_URL + "/registration.html?checkout=cancelled",
    customer_email: registration.data.email,
    client_reference_id: reference,
    "metadata[reference]": reference,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": "MatAi 2027 Registration",
    "line_items[0][price_data][product_data][description]": registration.items.map((item) =>
      item.name + " x" + item.quantity).join(", ").slice(0, 450),
    "line_items[0][price_data][unit_amount]": String(registration.totalCents),
    "line_items[0][quantity]": "1"
  };
  let session;
  try {
    session = await stripeRequest("checkout/sessions", params);
    if (!session.id || !session.url) throw new Error("Stripe did not return a checkout URL.");
    const record = {
      reference, kind: "register", receivedAt: new Date().toISOString(), ip: req.ip, status: "New",
      paymentStatus: "Pending", amount: registration.amount, stripeCheckoutSessionId: session.id,
      data: registration.data
    };
    await updateArr("register", async (arr) => { arr.push(record); });
    return res.status(201).json({ ok: true, reference, url: session.url, amount: registration.amount });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    if (session && session.id) {
      try { await stripeRequest("checkout/sessions/" + encodeURIComponent(session.id) + "/expire", {}); }
      catch (expireError) { console.error("Could not expire unrecorded Stripe checkout:", expireError); }
    }
    return res.status(502).json({ ok: false, error: "Could not start Stripe checkout. Please try again or contact the organizers." });
  }
});

app.get("/api/checkout/stripe/status/:sessionId", async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ ok: false, error: "Stripe checkout is not configured." });
  if (!/^cs_[A-Za-z0-9_]+$/.test(req.params.sessionId)) return res.status(400).json({ ok: false, error: "Invalid checkout session." });
  try {
    const session = await stripeRequest("checkout/sessions/" + encodeURIComponent(req.params.sessionId), null, "GET");
    const reference = session.metadata && session.metadata.reference || session.client_reference_id;
    const records = await readArr("register");
    const record = records.find((entry) => entry.reference === reference &&
      entry.stripeCheckoutSessionId === session.id);
    if (!record) return res.status(404).json({ ok: false, error: "Registration not found." });
    if (session.payment_status === "paid") await applyStripeSession(session, "paid");
    else if (session.status === "expired") await applyStripeSession(session, "cancelled");
    return res.json({
      ok: true, reference: record.reference,
      paid: session.payment_status === "paid",
      paymentStatus: session.payment_status === "paid" ? "Paid" : session.status === "expired" ? "Cancelled" : "Pending"
    });
  } catch (err) {
    console.error("Stripe checkout status lookup failed:", err);
    res.status(502).json({ ok: false, error: "Could not verify payment status yet." });
  }
});

app.post("/api/checkout/paypal/order", async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ ok: false, error: "PayPal checkout is not configured. Please choose bank transfer or contact the organizers." });
  }
  let registration;
  try {
    registration = await prepareRegistration(sanitize(req.body));
    if (registration.data.paymentGateway !== "PayPal") {
      return res.status(400).json({ ok: false, error: "Select PayPal to continue." });
    }
    const token = await paypalAccessToken();
    const reference = "MATAI-" + Date.now().toString(36).toUpperCase() +
      crypto.randomBytes(2).toString("hex").toUpperCase();
    const order = await paypalRequest("/v2/checkout/orders", token, {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: reference,
        custom_id: reference,
        description: registration.items.map((item) => item.name + " x" + item.quantity).join(", ").slice(0, 120),
        amount: { currency_code: "EUR", value: registration.amount.toFixed(2) }
      }],
      payment_source: { paypal: { experience_context: {
        brand_name: "MatAi 2027",
        user_action: "PAY_NOW",
        return_url: PUBLIC_BASE_URL + "/registration.html?checkout=paypal-return",
        cancel_url: PUBLIC_BASE_URL + "/registration.html?checkout=paypal-cancelled"
      } } }
    });
    const approval = (order.links || []).find((link) => link.rel === "payer-action" || link.rel === "approve");
    if (!order.id || !approval || !/^https:\/\/([a-z0-9-]+\.)*paypal\.com$/i.test(new URL(approval.href).origin)) {
      throw new Error("PayPal did not return a valid approval link.");
    }
    await updateArr("register", async (arr) => {
      arr.push({
        reference, kind: "register", receivedAt: new Date().toISOString(), ip: req.ip, status: "New",
        paymentStatus: "Pending", amount: registration.amount, paypalOrderId: order.id,
        data: registration.data
      });
    });
    res.status(201).json({ ok: true, reference, orderId: order.id, approvalUrl: approval.href, amount: registration.amount });
  } catch (err) {
    console.error("PayPal order creation failed:", err);
    res.status(err.statusCode || 502).json({ ok: false, error: "Could not start PayPal checkout. Please try again or contact the organizers." });
  }
});

app.post("/api/checkout/paypal/capture", async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return res.status(503).json({ ok: false, error: "PayPal checkout is not configured." });
  const orderId = String(req.body && req.body.orderId || "");
  if (!/^[-A-Za-z0-9]+$/.test(orderId)) return res.status(400).json({ ok: false, error: "Invalid PayPal order." });
  try {
    const records = await readArr("register");
    const record = records.find((entry) => entry.paypalOrderId === orderId);
    if (!record) return res.status(404).json({ ok: false, error: "Registration not found for this PayPal order." });
    if (record.paymentStatus === "Paid") return res.json({ ok: true, paid: true, reference: record.reference });
    const token = await paypalAccessToken();
    const order = await paypalRequest("/v2/checkout/orders/" + encodeURIComponent(orderId), token, null);
    const purchase = order.purchase_units && order.purchase_units.find((unit) => unit.custom_id === record.reference);
    if (!purchase || purchase.amount.currency_code !== "EUR" ||
        Math.round(Number(purchase.amount.value) * 100) !== Math.round(Number(record.amount) * 100)) {
      return res.status(400).json({ ok: false, error: "PayPal order amount or registration reference did not match." });
    }
    let captureResult = order;
    if (order.status !== "COMPLETED") {
      captureResult = await paypalRequest("/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", token, {});
    }
    const capturedPurchase = captureResult.purchase_units && captureResult.purchase_units.find((unit) => unit.custom_id === record.reference);
    const captures = capturedPurchase && capturedPurchase.payments && capturedPurchase.payments.captures || [];
    const completedCapture = captures.find((capture) => capture.status === "COMPLETED" &&
      capture.amount && capture.amount.currency_code === "EUR" &&
      Math.round(Number(capture.amount.value) * 100) === Math.round(Number(record.amount) * 100));
    if (captureResult.status !== "COMPLETED" || !completedCapture) {
      return res.status(409).json({ ok: true, paid: false, reference: record.reference, error: "PayPal has not confirmed the payment yet." });
    }
    await markRegistrationPaid(record.reference, orderId, "paypal", {
      paypalCaptureId: completedCapture.id || ""
    });
    res.json({ ok: true, paid: true, reference: record.reference });
  } catch (err) {
    console.error("PayPal capture verification failed:", err);
    res.status(502).json({ ok: false, error: "Could not verify PayPal payment yet. Contact the organizers if you were charged." });
  }
});

app.post("/api/checkout/razorpay/order", async (req, res) => {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !/^[A-Z]{3}$/.test(RAZORPAY_CURRENCY)) {
    return res.status(503).json({ ok: false, error: "Razorpay checkout is not configured. Please choose bank transfer or contact the organizers." });
  }
  let registration;
  try {
    registration = await prepareRegistration(sanitize(req.body));
    if (registration.data.paymentGateway !== "Razorpay") {
      return res.status(400).json({ ok: false, error: "Select Razorpay to continue." });
    }
    const amount = Math.round(registration.amount * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Razorpay order amount is invalid for the configured currency." });
    }
    const reference = "MATAI-" + Date.now().toString(36).toUpperCase() +
      crypto.randomBytes(2).toString("hex").toUpperCase();
    const order = await razorpayRequest("orders", {
      amount,
      currency: RAZORPAY_CURRENCY,
      receipt: reference,
      notes: { reference, registration: "MatAi 2027" }
    }, "POST");
    if (!order.id || order.currency !== RAZORPAY_CURRENCY || Number(order.amount) !== amount) {
      throw new Error("Razorpay order details did not match the requested amount.");
    }
    await updateArr("register", async (arr) => {
      arr.push({
        reference, kind: "register", receivedAt: new Date().toISOString(), ip: req.ip, status: "New",
        paymentStatus: "Pending", amount: registration.amount, razorpayOrderId: order.id,
        razorpayCurrency: RAZORPAY_CURRENCY, data: registration.data
      });
    });
    res.status(201).json({
      ok: true, reference, orderId: order.id, keyId: RAZORPAY_KEY_ID,
      amount, currency: RAZORPAY_CURRENCY, displayAmount: registration.amount
    });
  } catch (err) {
    console.error("Razorpay order creation failed:", err);
    res.status(err.statusCode || 502).json({ ok: false, error: "Could not start Razorpay checkout. Please try again or contact the organizers." });
  }
});

app.post("/api/checkout/razorpay/verify", async (req, res) => {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return res.status(503).json({ ok: false, error: "Razorpay checkout is not configured." });
  const body = req.body || {};
  const orderId = String(body.razorpay_order_id || "");
  const paymentId = String(body.razorpay_payment_id || "");
  const signature = String(body.razorpay_signature || "");
  if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
      !/^[0-9a-f]{64}$/i.test(signature)) {
    return res.status(400).json({ ok: false, error: "Invalid Razorpay payment response." });
  }
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(orderId + "|" + paymentId).digest("hex");
  if (!constantTimeHexEqual(expected, signature)) {
    return res.status(400).json({ ok: false, error: "Razorpay payment signature verification failed." });
  }
  try {
    const records = await readArr("register");
    const record = records.find((entry) => entry.razorpayOrderId === orderId);
    if (!record) return res.status(404).json({ ok: false, error: "Registration not found for this Razorpay order." });
    if (record.paymentStatus === "Paid") return res.json({ ok: true, paid: true, reference: record.reference });
    const payment = await razorpayRequest("payments/" + encodeURIComponent(paymentId), null, "GET");
    const expectedAmount = Math.round(Number(record.amount) * 100);
    if (payment.order_id !== orderId || payment.currency !== (record.razorpayCurrency || RAZORPAY_CURRENCY) ||
        Number(payment.amount) !== expectedAmount || !["authorized", "captured"].includes(payment.status)) {
      return res.status(400).json({ ok: false, error: "Razorpay payment details did not match this registration." });
    }
    if (payment.status === "captured") {
      await markRegistrationPaid(record.reference, orderId, "razorpay", { razorpayPaymentId: paymentId });
      return res.json({ ok: true, paid: true, reference: record.reference });
    }
    return res.json({ ok: true, paid: false, reference: record.reference });
  } catch (err) {
    console.error("Razorpay payment verification failed:", err);
    res.status(502).json({ ok: false, error: "Could not verify Razorpay payment yet. Contact the organizers if you were charged." });
  }
});

app.post("/api/checkout/razorpay/cancel", async (req, res) => {
  const orderId = String(req.body && req.body.orderId || "");
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return res.status(400).json({ ok: false, error: "Invalid Razorpay order." });
  try {
    await updateArr("register", async (arr) => {
      const record = arr.find((entry) => entry.razorpayOrderId === orderId);
      applyVerifiedPaymentStatus(record, "Cancelled");
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Could not cancel Razorpay registration:", err);
    res.status(500).json({ ok: false, error: "Could not update Razorpay order status." });
  }
});

app.post("/api/:kind", parseAbstractUpload, async (req, res) => {
  const kind = req.params.kind;
  const required = FORMS[kind];
  if (!required) return res.status(404).json({ ok: false, error: "Unknown form." });

  const uploadedFile = req.file;
  const rejectSubmission = async (status, payload) => {
    await removeUploadedFile(uploadedFile);
    return res.status(status).json(payload);
  };
  const data = sanitize(req.body);
  const missing = required.filter((f) => {
    const v = data[f];
    return v === undefined || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) {
    return rejectSubmission(400, { ok: false, error: "Missing required fields.", fields: missing });
  }
  if (!isEmail(data.email)) {
    return rejectSubmission(400, { ok: false, error: "Invalid email address." });
  }
  if (uploadedFile && kind === "abstract") {
    try {
      if (!(await hasValidAbstractSignature(uploadedFile))) {
        return rejectSubmission(400, { ok: false, error: "The uploaded file does not match its PDF or Word document type." });
      }
    } catch (err) {
      console.error("Could not validate abstract upload:", err);
      return rejectSubmission(500, { ok: false, error: "Could not validate the uploaded document." });
    }
  }
  let registration;
  if (kind === "register") {
    try {
      registration = await prepareRegistration(data);
      if (registration.data.paymentGateway !== "Bank Transfer") {
        return rejectSubmission(400, { ok: false, error: "Online payment registrations must use the selected provider's secure checkout flow." });
      }
      Object.assign(data, registration.data);
    } catch (err) {
      await removeUploadedFile(uploadedFile);
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  }

  const reference = "MATAI-" + Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(2).toString("hex").toUpperCase();
  const record = {
    reference, kind,
    receivedAt: new Date().toISOString(),
    ip: req.ip,
    status: "New",
    data
  };
  if (uploadedFile) {
    record.attachment = {
      filename: path.basename(uploadedFile.filename),
      originalName: safeUploadName(uploadedFile.originalname),
      mimeType: uploadedFile.mimetype,
      size: uploadedFile.size
    };
  }
  if (kind === "register") {
    record.paymentStatus = "Pending";
    record.amount = registration.amount;
  }

  try {
    await updateArr(kind, async (arr) => { arr.push(record); });
    const resp = { ok: true, reference };
    if (kind === "brochure") resp.download = "/brochure.html";
    return res.status(201).json(resp);
  } catch (err) {
    console.error("Failed to store submission:", err);
    await removeUploadedFile(uploadedFile);
    return res.status(500).json({ ok: false, error: "Could not store submission." });
  }
});

/* ---------- Admin API (all protected) ---------- */
app.get("/admin/api/stats", requireAuth, async (req, res) => {
  try {
  const out = { counts: {}, revenue: 0, pending: 0, paid: 0, recent: [] };
  for (const k of KINDS) {
    const a = await readArr(k);
    out.counts[k] = a.length;
    if (k === "register") {
      a.forEach((r) => {
        if (r.paymentStatus === "Paid") { out.revenue += Number(r.amount) || 0; out.paid++; }
        else if (!r.paymentStatus || r.paymentStatus === "Pending") { out.pending++; }
      });
    }
    a.forEach((r) => out.recent.push({ reference: r.reference, kind: k, receivedAt: r.receivedAt, paymentStatus: r.paymentStatus || "" }));
  }
  out.recent.sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  out.recent = out.recent.slice(0, 10);
  res.json({ ok: true, stats: out });
  } catch (err) {
    console.error("Failed to read submission statistics:", err);
    res.status(500).json({ ok: false, error: "Could not load dashboard statistics." });
  }
});

app.get("/admin/api/submissions/:kind", requireAuth, async (req, res) => {
  const k = req.params.kind;
  if (KINDS.indexOf(k) < 0) return res.status(404).json({ ok: false, error: "Unknown kind" });
  try {
    res.json({ ok: true, items: (await readArr(k)).slice().reverse() });
  } catch (err) {
    console.error("Failed to read " + k + " submissions:", err);
    res.status(500).json({ ok: false, error: "Could not load submissions." });
  }
});

app.get("/admin/api/submissions/:kind/:ref/attachment", requireAuth, async (req, res) => {
  if (req.params.kind !== "abstract") return res.status(404).json({ ok: false, error: "Attachment not found." });
  try {
    const record = (await readArr("abstract")).find((item) => item.reference === req.params.ref);
    const attachment = record && record.attachment;
    if (!attachment || !/^[a-f0-9]{48}\.(pdf|doc|docx)$/.test(attachment.filename || "")) {
      return res.status(404).json({ ok: false, error: "Attachment not found." });
    }
    const filePath = path.join(UPLOAD_DIR, attachment.filename);
    await fsp.access(filePath, fs.constants.R_OK);
    res.download(filePath, safeUploadName(attachment.originalName), (err) => {
      if (err && !res.headersSent) {
        console.error("Could not download abstract attachment:", err);
        res.status(500).json({ ok: false, error: "Could not download the attachment." });
      }
    });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ ok: false, error: "Attachment not found." });
    console.error("Could not read abstract attachment:", err);
    res.status(500).json({ ok: false, error: "Could not read the attachment." });
  }
});

app.get("/admin/api/submissions", requireAuth, async (_req, res) => {
  try {
    const groups = await Promise.all(KINDS.map(async (kind) => ({
      kind,
      items: await readArr(kind)
    })));
    const items = groups.reduce((all, group) => {
      return all.concat(group.items.map((record) => Object.assign({ kind: group.kind }, record)));
    }, []);
    items.sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
    res.json({ ok: true, items });
  } catch (err) {
    console.error("Failed to read all submissions:", err);
    res.status(500).json({ ok: false, error: "Could not load submissions." });
  }
});

app.patch("/admin/api/submissions/:kind/:ref", requireAuth, async (req, res) => {
  const k = req.params.kind;
  if (KINDS.indexOf(k) < 0) return res.status(404).json({ ok: false, error: "Unknown kind" });
  try {
    const b = req.body || {};
    if (b.status !== undefined &&
        (typeof b.status !== "string" || !["New", "Reviewed", "Approved", "Rejected", "Completed"].includes(b.status))) {
      return res.status(400).json({ ok: false, error: "Invalid submission status." });
    }
    if (b.paymentStatus !== undefined &&
        (k !== "register" || typeof b.paymentStatus !== "string" ||
        !["Pending", "Paid", "Refunded", "Cancelled", "Failed"].includes(b.paymentStatus))) {
      return res.status(400).json({ ok: false, error: "Invalid payment status." });
    }
    if (b.adminNotes !== undefined && typeof b.adminNotes !== "string") {
      return res.status(400).json({ ok: false, error: "Admin notes must be text." });
    }
    let amount;
    if (b.amount !== undefined) {
      amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, error: "Amount must be a non-negative number." });
    }
    let data;
    if (b.data !== undefined) {
      if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) {
        return res.status(400).json({ ok: false, error: "Submission data must be an object." });
      }
      data = sanitize(b.data);
      if (data.email !== undefined && !isEmail(data.email)) {
        return res.status(400).json({ ok: false, error: "Invalid email address." });
      }
    }
    const record = await updateArr(k, async (arr) => {
      const rec = arr.find((r) => r.reference === req.params.ref);
      if (!rec) return null;
      if (b.status !== undefined) rec.status = b.status;
      if (b.paymentStatus !== undefined) rec.paymentStatus = b.paymentStatus;
      if (b.adminNotes !== undefined) rec.adminNotes = b.adminNotes.slice(0, 2000);
      if (amount !== undefined) rec.amount = amount;
      if (data !== undefined) rec.data = data;
      return rec;
    });
    if (!record) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, record });
  } catch (err) {
    console.error("Failed to update " + k + " submission:", err);
    res.status(500).json({ ok: false, error: "Could not update submission." });
  }
});

app.delete("/admin/api/submissions/:kind/:ref", requireAuth, async (req, res) => {
  const k = req.params.kind;
  if (KINDS.indexOf(k) < 0) return res.status(404).json({ ok: false, error: "Unknown kind" });
  try {
    const deleted = await updateArr(k, async (arr) => {
      const i = arr.findIndex((r) => r.reference === req.params.ref);
      if (i < 0) return false;
      return arr.splice(i, 1)[0];
    });
    if (!deleted) return res.status(404).json({ ok: false, error: "Not found" });
    if (deleted.attachment && /^[a-f0-9]{48}\.(pdf|doc|docx)$/.test(deleted.attachment.filename || "")) {
      await removeUploadedFile({ path: path.join(UPLOAD_DIR, deleted.attachment.filename) });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete " + k + " submission:", err);
    res.status(500).json({ ok: false, error: "Could not delete submission." });
  }
});

app.get("/admin/api/export/:kind", requireAuth, async (req, res) => {
  const k = req.params.kind;
  if (k !== "all" && KINDS.indexOf(k) < 0) return res.status(404).send("Unknown kind");
  let arr;
  try {
    if (k === "all") {
      const groups = await Promise.all(KINDS.map(async (kind) => ({
        kind,
        items: await readArr(kind)
      })));
      arr = groups.reduce((all, group) => {
        return all.concat(group.items.map((record) => Object.assign({ kind: group.kind }, record)));
      }, []);
    } else {
      arr = await readArr(k);
    }
  } catch (err) {
    console.error("Failed to export " + k + " submissions:", err);
    return res.status(500).json({ ok: false, error: "Could not export submissions." });
  }
  const rows = arr.map((r) => Object.assign({
    kind: r.kind || k, reference: r.reference, receivedAt: r.receivedAt, status: r.status || "",
    paymentStatus: r.paymentStatus || "", amount: r.amount != null ? r.amount : "",
    adminNotes: r.adminNotes || ""
  }, r.data || {}));
  const cols = [];
  rows.forEach((row) => Object.keys(row).forEach((c) => { if (cols.indexOf(c) < 0) cols.push(c); }));
  const csv = [cols.join(",")].concat(
    rows.map((row) => cols.map((c) => csvCell(row[c])).join(","))
  ).join("\r\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=" + k + "-" + Date.now() + ".csv");
  res.send(csv);
});

app.put("/admin/api/content", requireAuth, async (req, res) => {
  const incoming = req.body && req.body.content;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return res.status(400).json({ ok: false, error: "Invalid content" });
  try {
    const content = mergeDefaults(DEFAULT_CONTENT, incoming);
    await storage.saveContent(content);
    res.json({ ok: true, content });
  } catch (e) {
    console.error("Failed to save site content:", e);
    res.status(500).json({ ok: false, error: "Could not save content." });
  }
});

app.post("/admin/api/upload-image", requireAuth, (req, res) => {
  imageUpload.single("image")(req, res, async (err) => {
    if (err) {
      const tooLarge = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({ ok: false, error: tooLarge ? "Images must be 5 MB or smaller." : err.message });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: "Choose an image to upload." });
    try {
      if (!(await hasValidImageSignature(req.file))) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ ok: false, error: "The uploaded file is not a valid image." });
      }
      return res.json({ ok: true, path: "/uploads/" + path.basename(req.file.filename) });
    } catch (uploadError) {
      await removeUploadedFile(req.file);
      console.error("Could not validate uploaded image:", uploadError);
      return res.status(500).json({ ok: false, error: "Could not validate the uploaded image." });
    }
  });
});

/* ---------- Static site + SPA fallback ---------- */
app.use("/uploads", express.static(IMAGE_UPLOAD_DIR, { dotfiles: "deny", index: false, maxAge: "1d" }));
app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));

app.get(/^\/(?!api\/|admin\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

async function start() {
  try {
    const mode = await storage.initialize(DEFAULT_CONTENT);
    app.listen(PORT, () => {
      console.log(`MatAi 2027 running at http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
      console.log(`Storage: ${mode === "mysql" ? "MySQL database " + process.env.MYSQL_DATABASE : DATA_DIR}`);
      if (mode === "mysql") console.log("Legacy JSON data was imported once if this database had not been initialized before.");
    });
  } catch (err) {
    console.error("Could not initialize application storage:", err);
    await storage.close();
    process.exitCode = 1;
  }
}

start();
