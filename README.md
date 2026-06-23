# 活动报名管理后端 API

基于 Node.js + Express + SQLite 构建的活动报名管理系统后端 API。

## 功能特性

- **活动管理**：创建/编辑/删除活动、设置人数上限、状态自动切换（报名中/已满/已结束/已关闭）
- **报名管理**：用户报名/取消、满员自动进入候补队列、有人取消时自动递补
- **用户模块**：手机号注册登录、JWT 认证、个人资料管理
- **数据统计**：活动报名转化率、用户参与次数排行、全局概览
- **定时任务**：每 5 分钟自动刷新所有活动状态

## 业务规则

1. 同一时间段内不能重复报名其他活动
2. 活动开场前 2 小时自动截止报名
3. 活动满员后，新报名用户自动进入候补队列
4. 已报名用户取消时，候补队列第一位自动递补
5. JWT Token 有效期 7 天

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```
PORT=3000
JWT_SECRET=your-super-secret-jwt-key-change-in-production
DB_PATH=./data/events.db
```

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务启动后访问：`http://localhost:3000/api/health`

## API 接口文档

所有接口（除注册/登录外）需在请求头携带 JWT Token：

```
Authorization: Bearer <your-token>
```

---

### 一、用户模块 `/api/users`

#### 1.1 手机号注册

```
POST /api/users/register
```

请求体：

```json
{
  "phone": "13800138000",
  "password": "123456",
  "nickname": "张三"
}
```

响应：

```json
{
  "message": "注册成功",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "phone": "13800138000",
    "nickname": "张三"
  }
}
```

#### 1.2 登录

```
POST /api/users/login
```

请求体：

```json
{
  "phone": "13800138000",
  "password": "123456"
}
```

#### 1.3 获取个人资料

```
GET /api/users/profile
```

#### 1.4 修改个人资料

```
PUT /api/users/profile
```

请求体：

```json
{
  "nickname": "新昵称"
}
```

---

### 二、活动管理 `/api/events`

#### 2.1 创建活动

```
POST /api/events
```

请求体：

```json
{
  "title": "2026 线下产品发布会",
  "description": "年度新品发布，诚邀您的参与",
  "location": "北京市朝阳区某酒店 3 层宴会厅",
  "start_time": "2026-07-01T14:00:00.000Z",
  "end_time": "2026-07-01T18:00:00.000Z",
  "max_attendees": 100
}
```

活动状态说明：
- `registering`：报名中（可正常报名）
- `full`：已满员（进入候补队列）
- `closed`：已截止（开场前 2 小时自动截止）
- `ended`：已结束

#### 2.2 获取活动列表

```
GET /api/events?page=1&page_size=20&status=registering
```

查询参数：
- `status`：可选，按状态筛选
- `page`：页码，默认 1
- `page_size`：每页数量，默认 20

#### 2.3 获取活动详情

```
GET /api/events/:id
```

返回活动信息、已报名名单、候补队列名单。

#### 2.4 编辑活动

```
PUT /api/events/:id
```

仅活动创建者可编辑。

#### 2.5 删除活动

```
DELETE /api/events/:id
```

仅活动创建者可删除，删除时自动清除所有报名和候补记录。

---

### 三、报名管理 `/api/registrations`

#### 3.1 报名活动

```
POST /api/registrations/:eventId/register
```

响应说明：
- 若活动未满员：`{ "message": "报名成功", "result": { "status": "confirmed" } }`
- 若活动已满员：`{ "message": "活动已满，已加入候补队列", "result": { "status": "waitlist", "position": 1 } }`
- 若存在时间冲突：返回 400 错误

#### 3.2 取消报名

```
POST /api/registrations/:eventId/cancel
```

- 取消成功且有人递补：`{ "message": "取消成功，候补第一位用户已递补" }`
- 仅取消无递补：`{ "message": "取消成功" }`
- 取消候补：`{ "message": "已从候补队列中移除" }`

#### 3.3 查看我的报名

```
GET /api/registrations/my-registrations?status=all
```

查询参数 `status`：
- `all`：全部（默认）
- `confirmed`：已确认报名
- `cancelled`：已取消

---

### 四、数据统计 `/api/stats`

#### 4.1 全局概览

```
GET /api/stats/overview
```

返回总用户数、总活动数、总报名数、整体转化率、即将开始和最近结束的活动。

#### 4.2 活动统计列表

```
GET /api/stats/events/summary?sort_by=registration_rate&sort_order=desc
```

关键指标：
- `confirmed_count`：实际确认报名数
- `cancelled_count`：取消报名数
- `total_signups`：总报名尝试数
- `registration_rate`：报名转化率（确认报名 / 总报名）
- `fill_rate`：人员填充率（确认报名 / 人数上限）

排序字段：`start_time`、`registration_rate`、`confirmed_count`、`max_attendees`

#### 4.3 单个活动详细统计

```
GET /api/stats/events/:id/detail
```

返回活动各指标详情及按小时统计的报名趋势。

#### 4.4 用户参与排行

```
GET /api/stats/users/ranking?limit=20
```

按确认参与次数倒序排列，包含：
- `total_participations`：总报名次数
- `confirmed_participations`：实际参与次数
- `attendance_rate`：参与率

---

## 项目目录结构

```
project34/
├── src/
│   ├── config/           # 配置文件
│   ├── db/               # 数据库连接
│   ├── middleware/       # 中间件（JWT 认证）
│   ├── routes/           # 路由模块
│   │   ├── users.js          # 用户模块
│   │   ├── events.js         # 活动管理
│   │   ├── registrations.js  # 报名管理
│   │   └── stats.js          # 数据统计
│   ├── scheduler/        # 定时任务
│   ├── scripts/          # 脚本（数据库初始化）
│   ├── utils/            # 工具函数
│   ├── app.js            # Express 应用入口
│   └── server.js         # 服务器启动
├── data/                 # SQLite 数据库文件（自动生成）
├── .env                  # 环境变量
└── package.json
```

## 技术栈

| 技术 | 说明 |
|------|------|
| Node.js | 运行环境 |
| Express 4.x | Web 框架 |
| better-sqlite3 | SQLite 驱动（同步 API，性能优秀） |
| jsonwebtoken | JWT 认证 |
| bcryptjs | 密码加密 |
| node-cron | 定时任务调度 |
| cors | 跨域支持 |

## 常见问题

**Q: 数据库文件在哪里？**
A: 默认在 `./data/events.db`，可在 `.env` 中通过 `DB_PATH` 修改。

**Q: Token 过期怎么办？**
A: Token 有效期 7 天，过期后需重新登录获取新 Token。

**Q: 如何调试定时任务？**
A: 定时任务每 5 分钟执行一次，控制台会打印更新的活动数量。
