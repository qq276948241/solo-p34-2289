const express = require('express');
const cors = require('cors');
const path = require('path');

const initDatabase = require('./scripts/initDb');
const runMigrations = require('./scripts/migrate');
const { startStatusScheduler } = require('./scheduler/eventStatus');

const userRoutes = require('./routes/users');
const { router: eventRoutes } = require('./routes/events');
const registrationRoutes = require('./routes/registrations');
const statsRoutes = require('./routes/stats');

initDatabase();
runMigrations();
startStatusScheduler();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/api/users', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/stats', statsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'API 路径不存在', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  console.error(err.stack);
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

module.exports = app;
