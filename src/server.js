const express = require('express');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const { fetchWithCustomReferer } = require('./fetchWithCustomReferer');
const { rewritePlaylistUrls } = require('./rewritePlaylistUrls');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const helmet = require('helmet');
const { cleanEnv, str, num } = require('envalid');

// Validate environment variables
const env = cleanEnv(process.env, {
  PORT: num({ default: 3000 }),
  ALLOWED_ORIGINS: str({ default: "http://localhost:3000,https://your-website.com" }),
  REFERER_URL: str({ default: "https://megacloud.club/" })
});

const app = express();
const PORT = env.PORT;

// Initialize cache with a TTL of 10 minutes (600 seconds)
const cache = new NodeCache({ stdTTL: 600 });

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests, please try again later."
});

// Logging middleware
app.use(morgan('combined'));

// Security headers middleware
app.use(helmet());

// Apply rate limiting to all requests
app.use(limiter);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',');
  
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(o => o.startsWith('*.') && origin.endsWith(o.replace('*.', '')))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  next();
});

// Handle CORS preflight requests
app.options('*', (req, res) => {
  res.status(204).end();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Proxy endpoint with caching
app.get('/api/v1/streamingProxy', async (req, res) => {
  const url = decodeURIComponent(req.query.url);
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }

  // Check cache for the URL
  const cachedResponse = cache.get(url);
  if (cachedResponse) {
    console.log(`Serving from cache: ${url}`);
    return res.status(200).send(cachedResponse);
  }

  try {
    const response = await fetchWithCustomReferer(url, env.REFERER_URL);
    const isM3U8 = url.endsWith(".m3u8");

    if (!response.ok) {
      return res.status(response.status).json({ error: response.statusText });
    }

    if (isM3U8) {
      const playlistText = await response.text();
      const modifiedPlaylist = rewritePlaylistUrls(playlistText, url);

      // Cache the response
      cache.set(url, modifiedPlaylist);

      res.set({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      return res.send(modifiedPlaylist);
    } else {
      const arrayBuffer = await response.arrayBuffer();

      // Cache the response
      cache.set(url, Buffer.from(arrayBuffer));

      res.set({
        "Content-Type": "video/mp2t",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
