const express = require('express');
const db = require('../db/connection');
const authMiddleware = require('../middleware/auth');
const { calculateEventStatus, EVENT_STATUS, isRegistrationOpen } = require('../utils/helpers');

const router = express.Router();

function enrichEventWithStats(event) {
  const registeredCount = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = 'confirmed'")
    .get(event.id).count;

  const waitlistCount = db
    .prepare("SELECT COUNT(*) as count FROM waitlists WHERE event_id = ? AND status = 'waiting'")
    .get(event.id).count;

  const checkedInCount = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = 'confirmed' AND checked_in_at IS NOT NULL")
    .get(event.id).count;

  const currentStatus = calculateEventStatus(event, registeredCount);

  if (currentStatus !== event.status) {
    db.prepare('UPDATE events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      currentStatus,
      event.id
    );
    event.status = currentStatus;
  }

  return {
    ...event,
    registered_count: registeredCount,
    waitlist_count: waitlistCount,
    checked_in_count: checkedInCount,
    checkin_rate: registeredCount > 0
      ? parseFloat(((checkedInCount * 100) / registeredCount).toFixed(2))
      : 0,
    is_registration_open: isRegistrationOpen(event),
  };
}

router.post('/', authMiddleware, (req, res) => {
  const { title, description, location, start_time, end_time, max_attendees } = req.body;

  if (!title || !start_time || !end_time) {
    return res.status(400).json({ error: '标题、开始时间和结束时间不能为空' });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '时间格式不正确' });
  }

  if (start >= end) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  const maxAttendees = max_attendees || 50;
  if (maxAttendees < 1) {
    return res.status(400).json({ error: '人数上限必须大于0' });
  }

  const result = db
    .prepare(
      `INSERT INTO events (title, description, location, start_time, end_time, max_attendees, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      description || null,
      location || null,
      start.toISOString(),
      end.toISOString(),
      maxAttendees,
      req.user.userId,
      EVENT_STATUS.REGISTERING
    );

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ message: '活动创建成功', event: enrichEventWithStats(event) });
});

router.get('/', authMiddleware, (req, res) => {
  const { status, page = 1, page_size = 20 } = req.query;
  const offset = (page - 1) * page_size;

  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as count')).get(...params).count;

  sql += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
  params.push(parseInt(page_size), offset);

  const events = db.prepare(sql).all(...params);

  const enrichedEvents = events.map(enrichEventWithStats);

  res.json({
    data: enrichedEvents,
    pagination: {
      page: parseInt(page),
      page_size: parseInt(page_size),
      total,
      total_pages: Math.ceil(total / page_size),
    },
  });
});

router.get('/:id', authMiddleware, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);

  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  const enriched = enrichEventWithStats(event);

  const registrations = db
    .prepare(
      `SELECT r.id, r.user_id, r.status, r.registered_at, r.checked_in_at, u.phone, u.nickname
       FROM registrations r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.event_id = ?
       ORDER BY r.registered_at ASC`
    )
    .all(req.params.id);

  const waitlists = db
    .prepare(
      `SELECT w.id, w.user_id, w.position, w.status, w.joined_at, u.phone, u.nickname
       FROM waitlists w
       LEFT JOIN users u ON w.user_id = u.id
       WHERE w.event_id = ? AND w.status = 'waiting'
       ORDER BY w.position ASC`
    )
    .all(req.params.id);

  res.json({
    event: enriched,
    registrations,
    waitlists,
  });
});

router.put('/:id', authMiddleware, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);

  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  if (event.created_by !== req.user.userId) {
    return res.status(403).json({ error: '无权修改此活动' });
  }

  const { title, description, location, start_time, end_time, max_attendees } = req.body;

  let finalStart = event.start_time;
  let finalEnd = event.end_time;
  let finalMax = event.max_attendees;

  if (start_time) {
    const start = new Date(start_time);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ error: '开始时间格式不正确' });
    }
    finalStart = start.toISOString();
  }

  if (end_time) {
    const end = new Date(end_time);
    if (isNaN(end.getTime())) {
      return res.status(400).json({ error: '结束时间格式不正确' });
    }
    finalEnd = end.toISOString();
  }

  if (new Date(finalStart) >= new Date(finalEnd)) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  if (max_attendees !== undefined) {
    if (max_attendees < 1) {
      return res.status(400).json({ error: '人数上限必须大于0' });
    }
    finalMax = max_attendees;
  }

  db.prepare(
    `UPDATE events
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         location = COALESCE(?, location),
         start_time = ?,
         end_time = ?,
         max_attendees = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    title || null,
    description !== undefined ? description : null,
    location !== undefined ? location : null,
    finalStart,
    finalEnd,
    finalMax,
    req.params.id
  );

  const updatedEvent = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  res.json({ message: '活动更新成功', event: enrichEventWithStats(updatedEvent) });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);

  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  if (event.created_by !== req.user.userId) {
    return res.status(403).json({ error: '无权删除此活动' });
  }

  const deleteTx = db.transaction(() => {
    db.prepare("DELETE FROM registrations WHERE event_id = ?").run(req.params.id);
    db.prepare("DELETE FROM waitlists WHERE event_id = ?").run(req.params.id);
    db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  });

  deleteTx();

  res.json({ message: '活动删除成功' });
});

module.exports = { router, enrichEventWithStats, calculateEventStatus };
