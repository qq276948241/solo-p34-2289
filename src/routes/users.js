const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { jwtSecret, jwtExpiresIn } = require('../config');
const authMiddleware = require('../middleware/auth');
const { validatePhone } = require('../utils/helpers');

const router = express.Router();

router.post('/register', (req, res) => {
  const { phone, password, nickname } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: '手机号和密码不能为空' });
  }

  if (!validatePhone(phone)) {
    return res.status(400).json({ error: '手机号格式不正确' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existingUser) {
    return res.status(409).json({ error: '该手机号已注册' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const result = db
    .prepare('INSERT INTO users (phone, password_hash, nickname) VALUES (?, ?, ?)')
    .run(phone, passwordHash, nickname || `用户${phone.slice(-4)}`);

  const userId = result.lastInsertRowid;
  const token = jwt.sign({ userId, phone }, jwtSecret, { expiresIn: jwtExpiresIn });

  res.status(201).json({
    message: '注册成功',
    token,
    user: {
      id: userId,
      phone,
      nickname: nickname || `用户${phone.slice(-4)}`,
    },
  });
});

router.post('/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: '手机号和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }

  const token = jwt.sign({ userId: user.id, phone: user.phone }, jwtSecret, {
    expiresIn: jwtExpiresIn,
  });

  res.json({
    message: '登录成功',
    token,
    user: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
    },
  });
});

router.get('/profile', authMiddleware, (req, res) => {
  const user = db
    .prepare('SELECT id, phone, nickname, created_at FROM users WHERE id = ?')
    .get(req.user.userId);

  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const registrationCount = db
    .prepare(
      "SELECT COUNT(*) as count FROM registrations WHERE user_id = ? AND status = 'confirmed'"
    )
    .get(req.user.userId).count;

  const waitlistCount = db
    .prepare("SELECT COUNT(*) as count FROM waitlists WHERE user_id = ? AND status = 'waiting'")
    .get(req.user.userId).count;

  res.json({
    ...user,
    registration_count: registrationCount,
    waitlist_count: waitlistCount,
  });
});

router.put('/profile', authMiddleware, (req, res) => {
  const { nickname } = req.body;

  if (!nickname || nickname.trim().length === 0) {
    return res.status(400).json({ error: '昵称不能为空' });
  }

  db.prepare('UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    nickname.trim(),
    req.user.userId
  );

  const user = db
    .prepare('SELECT id, phone, nickname, created_at FROM users WHERE id = ?')
    .get(req.user.userId);

  res.json({ message: '资料更新成功', user });
});

module.exports = router;
