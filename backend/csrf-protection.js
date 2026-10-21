"use strict";

const { safeEqual } = require("./admin-auth");

function createCsrfProtection(getSession, compareTokens = safeEqual) {
  return function csrfProtection(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const current = getSession(req);
    const suppliedToken = req.get("x-csrf-token");
    if (!current || !compareTokens(current.session.csrf, suppliedToken)) {
      return res.status(419).json({ ok: false, error: "The request security token is invalid or expired." });
    }
    next();
  };
}

module.exports = { createCsrfProtection };
