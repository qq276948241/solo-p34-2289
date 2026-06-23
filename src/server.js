const app = require('./app');
const { port } = require('./config');

const server = app.listen(port, () => {
  console.log('');
  console.log('========================================');
  console.log('  活动报名管理 API 服务已启动');
  console.log(`  服务地址: http://localhost:${port}`);
  console.log(`  健康检查: http://localhost:${port}/api/health`);
  console.log('========================================');
  console.log('');
});

process.on('SIGTERM', () => {
  console.log('[Server] 收到 SIGTERM 信号，正在关闭服务...');
  server.close(() => {
    console.log('[Server] 服务已正常关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[Server] 收到 SIGINT 信号，正在关闭服务...');
  server.close(() => {
    console.log('[Server] 服务已正常关闭');
    process.exit(0);
  });
});
