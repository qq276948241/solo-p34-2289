require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  jwtExpiresIn: '7d',
  dbPath: process.env.DB_PATH || './data/events.db',
  registrationCutoffHours: 2,
};
