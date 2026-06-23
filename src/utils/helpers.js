const config = require('../config');

const EVENT_STATUS = {
  REGISTERING: 'registering',
  FULL: 'full',
  ENDED: 'ended',
  CLOSED: 'closed',
};

function calculateEventStatus(event, registeredCount) {
  const now = new Date();
  const startTime = new Date(event.start_time);
  const cutoffTime = new Date(startTime.getTime() - config.registrationCutoffHours * 60 * 60 * 1000);

  if (now >= cutoffTime || now >= startTime) {
    return EVENT_STATUS.CLOSED;
  }

  if (event.end_time && now >= new Date(event.end_time)) {
    return EVENT_STATUS.ENDED;
  }

  if (registeredCount >= event.max_attendees) {
    return EVENT_STATUS.FULL;
  }

  return EVENT_STATUS.REGISTERING;
}

function isTimeOverlap(start1, end1, start2, end2) {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();
  return s1 < e2 && s2 < e1;
}

function isRegistrationOpen(event) {
  const now = new Date();
  const startTime = new Date(event.start_time);
  const cutoffTime = new Date(startTime.getTime() - config.registrationCutoffHours * 60 * 60 * 1000);
  return now < cutoffTime && now < startTime;
}

function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

function isCheckinWindowOpen(event) {
  const now = new Date();
  const startTime = new Date(event.start_time);
  const oneHourBefore = new Date(startTime.getTime() - 60 * 60 * 1000);
  const oneHourAfter = new Date(startTime.getTime() + 60 * 60 * 1000);
  return now >= oneHourBefore && now <= oneHourAfter;
}

module.exports = {
  EVENT_STATUS,
  calculateEventStatus,
  isTimeOverlap,
  isRegistrationOpen,
  validatePhone,
  isCheckinWindowOpen,
};
