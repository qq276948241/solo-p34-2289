const express = require('express');
const db = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/events/summary', authMiddleware, (req, res) => {
  const { page = 1, page_size = 20, sort_by = 'start_time', sort_order = 'desc' } = req.query;
  const offset = (page - 1) * page_size;

  const validSortColumns = ['start_time', 'registration_rate', 'confirmed_count', 'max_attendees', 'checkin_rate'];
  const validSortOrders = ['asc', 'desc'];
  const finalSortBy = validSortColumns.includes(sort_by) ? sort_by : 'start_time';
  const finalSortOrder = validSortOrders.includes(sort_order) ? sort_order : 'desc';

  const baseCountSql = `
    SELECT COUNT(*) as count FROM events
  `;
  const total = db.prepare(baseCountSql).get().count;

  const listSql = `
    SELECT
      e.id,
      e.title,
      e.start_time,
      e.end_time,
      e.location,
      e.max_attendees,
      e.status,
      e.created_at,
      COALESCE(confirmed.cnt, 0) as confirmed_count,
      COALESCE(cancelled.cnt, 0) as cancelled_count,
      COALESCE(waiting.cnt, 0) as waitlist_count,
      COALESCE(checkedin.cnt, 0) as checked_in_count,
      (COALESCE(confirmed.cnt, 0) + COALESCE(cancelled.cnt, 0)) as total_signups,
      ROUND(
        CASE WHEN (COALESCE(confirmed.cnt, 0) + COALESCE(cancelled.cnt, 0)) > 0
        THEN (COALESCE(confirmed.cnt, 0) * 100.0 / (COALESCE(confirmed.cnt, 0) + COALESCE(cancelled.cnt, 0)))
        ELSE 0 END, 2
      ) as registration_rate,
      ROUND(
        CASE WHEN e.max_attendees > 0
        THEN (COALESCE(confirmed.cnt, 0) * 100.0 / e.max_attendees)
        ELSE 0 END, 2
      ) as fill_rate,
      ROUND(
        CASE WHEN COALESCE(confirmed.cnt, 0) > 0
        THEN (COALESCE(checkedin.cnt, 0) * 100.0 / COALESCE(confirmed.cnt, 0))
        ELSE 0 END, 2
      ) as checkin_rate
    FROM events e
    LEFT JOIN (
      SELECT event_id, COUNT(*) as cnt
      FROM registrations
      WHERE status = 'confirmed'
      GROUP BY event_id
    ) confirmed ON e.id = confirmed.event_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) as cnt
      FROM registrations
      WHERE status = 'cancelled'
      GROUP BY event_id
    ) cancelled ON e.id = cancelled.event_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) as cnt
      FROM waitlists
      WHERE status = 'waiting'
      GROUP BY event_id
    ) waiting ON e.id = waiting.event_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) as cnt
      FROM registrations
      WHERE status = 'confirmed' AND checked_in_at IS NOT NULL
      GROUP BY event_id
    ) checkedin ON e.id = checkedin.event_id
    ORDER BY ${finalSortBy} ${finalSortOrder.toUpperCase()}
    LIMIT ? OFFSET ?
  `;

  const events = db.prepare(listSql).all(parseInt(page_size), offset);

  res.json({
    data: events,
    pagination: {
      page: parseInt(page),
      page_size: parseInt(page_size),
      total,
      total_pages: Math.ceil(total / page_size),
    },
  });
});

router.get('/events/:id/detail', authMiddleware, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    return res.status(404).json({ error: '活动不存在' });
  }

  const confirmed = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE event_id = ? AND status = 'confirmed'")
    .get(req.params.id).cnt;

  const cancelled = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE event_id = ? AND status = 'cancelled'")
    .get(req.params.id).cnt;

  const waitlist = db
    .prepare("SELECT COUNT(*) as cnt FROM waitlists WHERE event_id = ? AND status = 'waiting'")
    .get(req.params.id).cnt;

  const promoted = db
    .prepare("SELECT COUNT(*) as cnt FROM waitlists WHERE event_id = ? AND status = 'promoted'")
    .get(req.params.id).cnt;

  const checkedIn = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE event_id = ? AND status = 'confirmed' AND checked_in_at IS NOT NULL")
    .get(req.params.id).cnt;

  const totalSignups = confirmed + cancelled;
  const registrationRate = totalSignups > 0 ? (confirmed * 100 / totalSignups).toFixed(2) : 0;
  const fillRate = event.max_attendees > 0 ? (confirmed * 100 / event.max_attendees).toFixed(2) : 0;
  const checkinRate = confirmed > 0 ? (checkedIn * 100 / confirmed).toFixed(2) : 0;

  const hourlyData = db
    .prepare(
      `SELECT
         STRFTIME('%Y-%m-%d %H:00:00', registered_at) as hour,
         COUNT(*) as count
       FROM registrations
       WHERE event_id = ? AND status = 'confirmed'
       GROUP BY hour
       ORDER BY hour ASC`
    )
    .all(req.params.id);

  res.json({
    event: {
      id: event.id,
      title: event.title,
      location: event.location,
      start_time: event.start_time,
      end_time: event.end_time,
      max_attendees: event.max_attendees,
    },
    stats: {
      confirmed_count: confirmed,
      cancelled_count: cancelled,
      waitlist_count: waitlist,
      promoted_count: promoted,
      checked_in_count: checkedIn,
      total_signups: totalSignups,
      registration_rate: parseFloat(registrationRate),
      fill_rate: parseFloat(fillRate),
      checkin_rate: parseFloat(checkinRate),
    },
    hourly_registrations: hourlyData,
  });
});

router.get('/users/ranking', authMiddleware, (req, res) => {
  const { limit = 20 } = req.query;
  const topLimit = Math.min(parseInt(limit) || 20, 100);

  const rankingSql = `
    SELECT
      u.id,
      u.phone,
      u.nickname,
      u.created_at,
      COALESCE(reg.cnt, 0) as total_participations,
      COALESCE(confirmed.cnt, 0) as confirmed_participations,
      COALESCE(cancelled.cnt, 0) as cancelled_count,
      COALESCE(waitlist.cnt, 0) as waitlist_count,
      ROUND(
        CASE WHEN (COALESCE(confirmed.cnt, 0) + COALESCE(cancelled.cnt, 0)) > 0
        THEN (COALESCE(confirmed.cnt, 0) * 100.0 / (COALESCE(confirmed.cnt, 0) + COALESCE(cancelled.cnt, 0)))
        ELSE 0 END, 2
      ) as attendance_rate
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) as cnt
      FROM registrations
      GROUP BY user_id
    ) reg ON u.id = reg.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as cnt
      FROM registrations
      WHERE status = 'confirmed'
      GROUP BY user_id
    ) confirmed ON u.id = confirmed.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as cnt
      FROM registrations
      WHERE status = 'cancelled'
      GROUP BY user_id
    ) cancelled ON u.id = cancelled.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as cnt
      FROM waitlists
      WHERE status = 'waiting'
      GROUP BY user_id
    ) waitlist ON u.id = waitlist.user_id
    ORDER BY confirmed_participations DESC, total_participations DESC
    LIMIT ?
  `;

  const ranking = db.prepare(rankingSql).all(topLimit);

  res.json({
    data: ranking,
    total_users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
  });
});

router.get('/overview', authMiddleware, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const totalEvents = db.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
  const totalRegistrations = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE status = 'confirmed'")
    .get().cnt;
  const totalCancelled = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE status = 'cancelled'")
    .get().cnt;
  const totalWaitlist = db
    .prepare("SELECT COUNT(*) as cnt FROM waitlists WHERE status = 'waiting'")
    .get().cnt;
  const totalCheckedIn = db
    .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE status = 'confirmed' AND checked_in_at IS NOT NULL")
    .get().cnt;

  const upcomingEvents = db
    .prepare(
      `SELECT e.id, e.title, e.start_time, e.max_attendees,
              COALESCE(r.cnt, 0) as registered_count,
              COALESCE(c.cnt, 0) as checked_in_count
       FROM events e
       LEFT JOIN (
         SELECT event_id, COUNT(*) as cnt
         FROM registrations WHERE status = 'confirmed'
         GROUP BY event_id
       ) r ON e.id = r.event_id
       LEFT JOIN (
         SELECT event_id, COUNT(*) as cnt
         FROM registrations WHERE status = 'confirmed' AND checked_in_at IS NOT NULL
         GROUP BY event_id
       ) c ON e.id = c.event_id
       WHERE e.start_time >= DATETIME('now')
       ORDER BY e.start_time ASC
       LIMIT 5`
    )
    .all();

  const recentEvents = db
    .prepare(
      `SELECT e.id, e.title, e.start_time, e.max_attendees,
              COALESCE(r.cnt, 0) as registered_count,
              COALESCE(c.cnt, 0) as checked_in_count,
              ROUND(
                CASE WHEN COALESCE(r.cnt, 0) > 0
                THEN (COALESCE(c.cnt, 0) * 100.0 / COALESCE(r.cnt, 0))
                ELSE 0 END, 2
              ) as checkin_rate
       FROM events e
       LEFT JOIN (
         SELECT event_id, COUNT(*) as cnt
         FROM registrations WHERE status = 'confirmed'
         GROUP BY event_id
       ) r ON e.id = r.event_id
       LEFT JOIN (
         SELECT event_id, COUNT(*) as cnt
         FROM registrations WHERE status = 'confirmed' AND checked_in_at IS NOT NULL
         GROUP BY event_id
       ) c ON e.id = c.event_id
       WHERE e.start_time < DATETIME('now')
       ORDER BY e.start_time DESC
       LIMIT 5`
    )
    .all();

  const overallConversion =
    totalRegistrations + totalCancelled > 0
      ? ((totalRegistrations * 100) / (totalRegistrations + totalCancelled)).toFixed(2)
      : '0.00';

  const overallCheckinRate =
    totalRegistrations > 0
      ? ((totalCheckedIn * 100) / totalRegistrations).toFixed(2)
      : '0.00';

  res.json({
    overview: {
      total_users: totalUsers,
      total_events: totalEvents,
      total_confirmed_registrations: totalRegistrations,
      total_cancelled: totalCancelled,
      total_waitlist: totalWaitlist,
      total_checked_in: totalCheckedIn,
      overall_conversion_rate: parseFloat(overallConversion),
      overall_checkin_rate: parseFloat(overallCheckinRate),
    },
    upcoming_events: upcomingEvents,
    recent_events: recentEvents,
  });
});

module.exports = router;
