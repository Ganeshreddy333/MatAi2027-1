"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveRegistrationPeriod } = require("../backend/registration-period");

test("category deadlines advance only the categories whose deadline has passed", () => {
  const periods = {
    active: "Early Bird",
    "Early Bird": {
      deadline: "2026-12-01",
      categoryDeadlines: { Speaker: "2026-11-02" }
    },
    "Mid-Term": {
      deadline: "To Be Announced",
      categoryDeadlines: { Speaker: "2026-12-01" }
    }
  };

  assert.equal(effectiveRegistrationPeriod(periods, "Speaker", "2026-11-03"), "Mid-Term");
  assert.equal(effectiveRegistrationPeriod(periods, "Delegate", "2026-11-03"), "Early Bird");
});

test("a category remains in its period through the configured deadline", () => {
  const periods = {
    active: "Early Bird",
    "Early Bird": {
      deadline: "2026-11-02",
      categoryDeadlines: { Speaker: "2026-11-03" }
    }
  };

  assert.equal(effectiveRegistrationPeriod(periods, "Speaker", "2026-11-03"), "Early Bird");
  assert.equal(effectiveRegistrationPeriod(periods, "Speaker", "2026-11-04"), "Mid-Term");
});

test("the final period closes after its own deadline", () => {
  const periods = {
    active: "On-Spot",
    "On-Spot": {
      deadline: "2026-11-02",
      categoryDeadlines: { Speaker: "2026-11-04" }
    }
  };

  assert.equal(effectiveRegistrationPeriod(periods, "Speaker", "2026-11-03"), "On-Spot");
  assert.equal(effectiveRegistrationPeriod(periods, "Delegate", "2026-11-03"), null);
  assert.equal(effectiveRegistrationPeriod(periods, "Speaker", "2026-11-05"), null);
});
