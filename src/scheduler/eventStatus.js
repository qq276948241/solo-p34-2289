const cron = require('node-cron');
const db = require('../db/connection');
const { calculateEventStatus, EVENT_STATUS } = require('../utils/helpers');

function refreshAllEventStatuses() {
  const events = db.prepare('SELECT * FROM events').all();
  let updatedCount = 0;

  const updateStmt = db.prepare(
    'UPDATE events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != ?'
  );

  const tx = db.transaction((eventsList) => {
    for (const event of eventsList) {
      const registeredCount = db
        .prepare("SELECT COUNT(*) as cnt FROM registrations WHERE event_id = ? AND status = 'confirmed'")
        .get(event.id).cnt;

      const newStatus = calculateEventStatus(event, registeredCount);
      if (newStatus !== event.status) {
        updateStmt.run(newStatus, event.id, newStatus);
        updatedCount++;
      }
    }
  });

  tx(events);
  return updatedCount;
}

function startStatusScheduler() {
  console.log('[Scheduler] 活动状态定时刷新任务已启动（每5分钟执行）');

  cron.schedule('*/5 * * * *', () => {
    try {
      const updated = refreshAllEventStatuses();
      if (updated > 0) {
        console.log(`[Scheduler] 已自动更新 ${updated} 个活动的状态`);
      }
    } catch (err) {
      console.error('[Scheduler] 刷新活动状态时出错:', err.message);
    }
  });
}

module.exports = { startStatusScheduler, refreshAllEventStatuses };
