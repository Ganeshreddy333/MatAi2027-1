"use strict";

const REGISTRATION_PERIODS = ["Early Bird", "Mid-Term", "On-Spot"];

function effectiveRegistrationPeriod(periods, category, today = new Date().toISOString().slice(0, 10)) {
  let index = REGISTRATION_PERIODS.indexOf(periods && periods.active);
  if (index < 0) index = 0;
  while (index < REGISTRATION_PERIODS.length - 1) {
    const current = periods && periods[REGISTRATION_PERIODS[index]];
    const deadline = current && current.categoryDeadlines && current.categoryDeadlines[category] || current && current.deadline;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || "") || deadline >= today) break;
    index += 1;
  }
  if (index === REGISTRATION_PERIODS.length - 1) {
    const current = periods && periods[REGISTRATION_PERIODS[index]];
    const deadline = current && current.categoryDeadlines && current.categoryDeadlines[category] || current && current.deadline;
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadline || "") && deadline < today) return null;
  }
  return REGISTRATION_PERIODS[index];
}

module.exports = { effectiveRegistrationPeriod };
