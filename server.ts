import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

interface BroadcastEvent {
  type: 'report:created' | 'report:status_updated' | 'report:upvoted';
  reportId: string;
  ticketId: string;
  status?: string;
  category?: string;
  actorName?: string;
  timestamp: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // Serve uploaded civic evidence photos
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'civic-report-portal', timestamp: new Date().toISOString() });
  });

  // Upload evidence photo safely to disk and return public URL
  app.post('/api/uploads', (req, res) => {
    try {
      const { dataUrl } = req.body as { dataUrl?: string };
      if (!dataUrl || typeof dataUrl !== 'string') {
        return res.status(400).json({ error: 'Missing image payload' });
      }

      const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) {
        return res.status(400).json({ error: 'Unsupported image format. Please use JPEG, PNG, or WebP.' });
      }

      const mimeType = match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      if (buffer.byteLength > 4 * 1024 * 1024) {
        return res.status(413).json({ error: 'Image must be 4 MB or smaller.' });
      }

      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const filename = `civic_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

      return res.json({ url: `/uploads/${filename}` });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'Failed to store uploaded photo.' });
    }
  });

  // Server-side Google Geocoding API proxy (avoids browser CORS trap)
  app.get('/api/geocode/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const language = typeof req.query.lang === 'string' ? req.query.lang : 'en';

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid latitude or longitude.' });
    }

    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!mapsKey) {
      return res.json({
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        source: 'coordinates',
      });
    }

    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${lat},${lng}`);
      url.searchParams.set('language', language);
      url.searchParams.set('key', mapsKey);

      const response = await fetch(url.toString());
      const payload = (await response.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{ formatted_address?: string }>;
      };

      if (response.status === 429 || payload.status === 'OVER_QUERY_LIMIT') {
        return res.status(429).json({
          error: 'Google Maps Geocoding quota exceeded.',
          status: 'RESOURCE_EXHAUSTED',
        });
      }

      if (payload.status === 'OK' && payload.results && payload.results[0]?.formatted_address) {
        return res.json({
          formattedAddress: payload.results[0].formatted_address,
          source: 'geocoding_api',
        });
      }

      return res.json({
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        source: 'coordinates',
      });
    } catch (err) {
      console.error('Reverse geocoding failed:', err);
      return res.json({
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        source: 'coordinates',
      });
    }
  });

  // Create HTTP server & attach real-time WebSocket server on port 3000
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcastPresence = () => {
    const activeCount = Array.from(wss.clients).filter((c) => c.readyState === WebSocket.OPEN).length;
    const msg = JSON.stringify({ type: 'presence:count', activeUsers: activeCount });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  wss.on('connection', (ws) => {
    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const text = raw.toString();
        if (text.length > 4096) return;
        const parsed = JSON.parse(text) as BroadcastEvent;
        if (
          parsed &&
          (parsed.type === 'report:created' ||
            parsed.type === 'report:status_updated' ||
            parsed.type === 'report:upvoted') &&
          typeof parsed.reportId === 'string' &&
          typeof parsed.ticketId === 'string'
        ) {
          const outbound = JSON.stringify({
            type: parsed.type,
            reportId: parsed.reportId.slice(0, 128),
            ticketId: parsed.ticketId.slice(0, 32),
            status: typeof parsed.status === 'string' ? parsed.status.slice(0, 32) : undefined,
            category: typeof parsed.category === 'string' ? parsed.category.slice(0, 32) : undefined,
            actorName: typeof parsed.actorName === 'string' ? parsed.actorName.slice(0, 80) : undefined,
            timestamp: new Date().toISOString(),
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(outbound);
            }
          });
        }
      } catch {
        // Ignore malformed client payloads
      }
    });

    ws.on('close', () => {
      broadcastPresence();
    });

    ws.on('error', () => {
      broadcastPresence();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Civic Report Portal server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
