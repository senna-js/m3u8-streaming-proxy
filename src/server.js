const express = require('express');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const { cleanEnv, str, num } = require('envalid');
const { pipeline } = require('stream/promises');

// Validate environment variables
const env = cleanEnv(process.env, {
  PORT: num({ default: 3000 }),
  REFERER_URL: str({ default: "https://megacloud.club/" }),
  MAX_CACHE_SIZE: num({ default: 100 }), // Max number of items in cache
  CACHE_TTL: num({ default: 300 }) // Cache TTL in seconds (5 minutes)
});

const app = express();
const PORT = env.PORT;

// Simple in-memory cache with size limit
const cache = new Map();
let cacheSize = 0;

// Middleware - only the essentials
app.use(express.static(path.join(__dirname, '../public')));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

// Helper function to fetch with Referer
async function fetchWithReferer(url) {
  const response = await fetch(url, {
    headers: {
      "Referer": env.REFERER_URL,
      "User-Agent": "Mozilla/5.0"
    }
  });
  return response;
}

// Proxy endpoint with streaming
app.get('/api/v1/streamingProxy', async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);
    if (!url) return res.status(400).json({ error: "URL parameter is required" });

    // Check cache
    if (cache.has(url)) {
      const { contentType, body } = cache.get(url);
      res.set('Content-Type', contentType);
      return res.send(body);
    }

    const response = await fetchWithReferer(url);
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: response.statusText,
        status: response.status
      });
    }

    const contentType = response.headers.get('content-type');
    const isM3U8 = url.endsWith(".m3u8");

    if (isM3U8) {
      // For playlists - process in memory but keep small
      const playlistText = await response.text();
      const modifiedPlaylist = playlistText.split('\n').map(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          try {
            const resolvedUrl = new URL(line, new URL(url).origin).href;
            return `/api/v1/streamingProxy?url=${encodeURIComponent(resolvedUrl)}`;
          } catch (e) {
            return line;
          }
        }
        return line;
      }).join('\n');

      // Cache small playlists only
      if (modifiedPlaylist.length < 10000) { // ~10KB max
        cache.set(url, { 
          contentType: 'application/vnd.apple.mpegurl', 
          body: modifiedPlaylist 
        });
        manageCacheSize();
      }

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(modifiedPlaylist);
    } else {
      // For media segments - stream directly
      res.set('Content-Type', contentType || 'video/mp2t');
      await pipeline(response.body, res);
      return;
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Manage cache size
function manageCacheSize() {
  if (cache.size > env.MAX_CACHE_SIZE) {
    // Delete oldest item (simple FIFO)
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// Memory monitoring endpoint
app.get('/memory', (req, res) => {
  const used = process.memoryUsage();
  res.json({
    rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    cacheSize: cache.size
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Memory usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
});
