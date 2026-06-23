const express = require('express');
const db = require('../db/connection');
const authMiddleware = require('../middleware/auth');
const { isTimeOverlap, isRegistrationOpen, isCheckinWindowOpen, EVENT_STATUS, calculateEventStatus } = require('../utils/helpers');
const { enrichEventWithStats } = require('./events');

const router = express.Router();

function checkTimeConflict(userId, eventStart, eventEnd, excludeEventId = null) {
  const myEvents = db
    .prepare(
      `SELECT e.start_time, e.end_time
       FROM registrations r
       JOIN events e ON r.event_id = e.id
       WHERE r.user_id = ?
         AND r.status = 'confirmed'
         ${excludeEventId ? 'AND e.id != ?' : ''}`
    )
    .all(excludeEventId ? [userId, excludeEventId] : [userId]);

  for (const ev of myEvents) {
    if (isTimeOverlap(eventStart, eventEnd, ev.start_time, ev.end_time)) {
      return true;
    }
  }

  return false;
}

function updateEventStatus(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;
  const registeredCount = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = 'confirmed'")
    .get(eventId).count;
  const newStatus = calculateEventStatus(event, registeredCount);
  if (newStatus !== event.status) {
    db.prepare('UPDATE events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newStatus,
      eventId
    );
  }
  return { ...event, status: newStatus, registered_count: registeredCount };
}

router.post('/:eventId/register', authMiddleware, (req, res) => {
  const eventId = req.params.eventId;
  const userId = req.user.userId;

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  if (!isRegistrationOpen(event)) {
    return res.status(400).json({ error: '报名已截止（开场前2小时截止）' });
  }

  const existingReg = db
    .prepare("SELECT * FROM registrations WHERE user_id = ? AND event_id = ? AND status = 'confirmed'")
    .get(userId, eventId);
  if (existingReg) {
    return res.status(409).json({ error: '您已报名该活动' });
  }

  const existingWait = db
    .prepare("SELECT * FROM waitlists WHERE user_id = ? AND event_id = ? AND status = 'waiting'")
    .get(userId, eventId);
  if (existingWait) {
    return res.status(409).json({ error: '您已在该活动候补队列中' });
  }

  if (checkTimeConflict(userId, event.start_time, event.end_time)) {
    return res.status(400).json({ error: '您已报名了同一时间段的其他活动' });
  }

  const registeredCount = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = 'confirmed'")
    .get(eventId).count;

  const registerTx = db.transaction(() => {
    if (registeredCount < event.max_attendees) {
      db.prepare(
        "INSERT INTO registrations (user_id, event_id, status, registered_at) VALUES (?, ?, 'confirmed', CURRENT_TIMESTAMP)"
      ).run(userId, eventId);

      const newCount = registeredCount + 1;
      let newStatus = event.status;
      if (newCount >= event.max_attendees) {
        newStatus = EVENT_STATUS.FULL;
      }
      db.prepare('UPDATE events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        newStatus,
        eventId
      );

      return { type: 'confirmed' };
    } else {
      const maxPosition = db
        .prepare('SELECT COALESCE(MAX(position), 0) as max_pos FROM waitlists WHERE event_id = ? AND status = ?')
        .get(eventId, 'waiting').max_pos;
      const newPosition = maxPosition + 1;

      db.prepare(
        'INSERT INTO waitlists (user_id, event_id, position, joined_at, status) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)'
      ).run(userId, eventId, newPosition, 'waiting');

      return { type: 'waitlist', position: newPosition };
    }
  });

  const result = registerTx();
  updateEventStatus(eventId);

  if (result.type === 'confirmed') {
    res.status(201).json({ message: '报名成功', result: { status: 'confirmed' } });
  } else {
    res.status(201).json({
      message: '活动已满，已加入候补队列',
      result: { status: 'waitlist', position: result.position },
    });
  }
});

router.post('/:eventId/cancel', authMiddleware, (req, res) => {
  const eventId = req.params.eventId;
  const userId = req.user.userId;

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  const registration = db
    .prepare("SELECT * FROM registrations WHERE user_id = ? AND event_id = ? AND status = 'confirmed'")
    .get(userId, eventId);

  const waitlistEntry = db
    .prepare("SELECT * FROM waitlists WHERE user_id = ? AND event_id = ? AND status = 'waiting'")
    .get(userId, eventId);

  if (!registration && !waitlistEntry) {
    return res.status(404).json({ error: '您未报名或候补该活动' });
  }

  const cancelTx = db.transaction(() => {
    if (registration) {
      db.prepare(
        "UPDATE registrations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(registration.id);

      const firstWaiter = db
        .prepare(
          "SELECT * FROM waitlists WHERE event_id = ? AND status = 'waiting' ORDER BY position ASC LIMIT 1"
        )
        .get(eventId);

      if (firstWaiter) {
        db.prepare(
          "UPDATE waitlists SET status = 'promoted', promoted_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(firstWaiter.id);

        db.prepare(
          "INSERT INTO registrations (user_id, event_id, status, registered_at) VALUES (?, ?, 'confirmed', CURRENT_TIMESTAMP)"
        ).run(firstWaiter.user_id, eventId);

        db.prepare(
          "UPDATE waitlists SET position = position - 1 WHERE event_id = ? AND status = 'waiting' AND position > ?"
        ).run(eventId, firstWaiter.position);

        return { type: 'cancel_and_promoted', promotedUserId: firstWaiter.user_id };
      }

      return { type: 'cancel_only' };
    }

    if (waitlistEntry) {
      db.prepare(
        "UPDATE waitlists SET status = 'cancelled' WHERE id = ?"
      ).run(waitlistEntry.id);

      db.prepare(
        "UPDATE waitlists SET position = position - 1 WHERE event_id = ? AND status = 'waiting' AND position > ?"
      ).run(eventId, waitlistEntry.position);

      return { type: 'waitlist_cancelled' };
    }
  });

  const result = cancelTx();
  updateEventStatus(eventId);

  const response = { message: '取消成功' };
  if (result.type === 'cancel_and_promoted') {
    response.message = '取消成功，候补第一位用户已递补';
  } else if (result.type === 'waitlist_cancelled') {
    response.message = '已从候补队列中移除';
  }

  res.json(response);
});

router.post('/:eventId/checkin', authMiddleware, (req, res) => {
  const eventId = req.params.eventId;
  const userId = req.user.userId;

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  const registration = db
    .prepare("SELECT * FROM registrations WHERE user_id = ? AND event_id = ? AND status = 'confirmed'")
    .get(userId, eventId);

  if (!registration) {
    return res.status(404).json({ error: '您未报名该活动或报名已取消' });
  }

  if (registration.checked_in_at) {
    return res.status(409).json({
      error: '您已完成签到',
      checked_in_at: registration.checked_in_at,
    });
  }

  if (!isCheckinWindowOpen(event)) {
    const startTime = new Date(event.start_time);
    const oneHourBefore = new Date(startTime.getTime() - 60 * 60 * 1000);
    const oneHourAfter = new Date(startTime.getTime() + 60 * 60 * 1000);
    return res.status(400).json({
      error: '不在签到时间窗口内（活动开始前后1小时）',
      checkin_window: {
        start: oneHourBefore.toISOString(),
        end: oneHourAfter.toISOString(),
      },
      event_start_time: event.start_time,
      current_time: new Date().toISOString(),
    });
  }

  db.prepare(
    'UPDATE registrations SET checked_in_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(registration.id);

  const updated = db.prepare('SELECT * FROM registrations WHERE id = ?').get(registration.id);

  res.json({
    message: '签到成功',
    result: {
      registration_id: updated.id,
      checked_in_at: updated.checked_in_at,
      event_title: event.title,
    },
  });
});

router.get('/my-registrations', authMiddleware, (req, res) => {
  const { status = 'all' } = req.query;

  let regSql = `
    SELECT r.id, r.event_id, r.status, r.registered_at, r.cancelled_at, r.checked_in_at,
           e.title, e.location, e.start_time, e.end_time, e.max_attendees
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE r.user_id = ?
  `;
  const params = [req.user.userId];

  if (status !== 'all') {
    regSql += ' AND r.status = ?';
    params.push(status);
  }
  regSql += ' ORDER BY e.start_time DESC';

  const registrations = db.prepare(regSql).all(...params);

  let waitSql = `
    SELECT w.id, w.event_id, w.position, w.status, w.joined_at, w.promoted_at,
           e.title, e.location, e.start_time, e.end_time
    FROM waitlists w
    JOIN events e ON w.event_id = e.id
    WHERE w.user_id = ?
  `;
  const waitParams = [req.user.userId];

  if (status === 'waiting') {
    waitSql += " AND w.status = 'waiting'";
  }
  waitSql += ' ORDER BY w.position ASC';

  const waitlists = db.prepare(waitSql).all(...waitParams);

  res.json({
    registrations: registrations.map(r => ({
      ...r,
      is_past: new Date(r.end_time) < new Date(),
      is_checked_in: !!r.checked_in_at,
      checkin_window: {
        start: new Date(new Date(r.start_time).getTime() - 60 * 60 * 1000).toISOString(),
        end: new Date(new Date(r.start_time).getTime() + 60 * 60 * 1000).toISOString(),
      },
    })),
    waitlists,
  });
});

module.exports = router;
