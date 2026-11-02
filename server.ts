import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { initializeDatabase } from './server/db.ts';
import { initializeSocketServer } from './server/socket.ts';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  initializeDatabase();

  const app = express();
  const httpServer = http.createServer(app);

  // Attach Socket.IO real-time collaboration server on same port
  initializeSocketServer(httpServer);

  app.use(express.json({ limit: '2mb' }));

  // Mount REST API routes
  app.use('/api', apiRouter);

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TenantFlow server (HTTP + Socket.IO) listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
