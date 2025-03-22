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
  ALLOWED_ORIGINS: str({ default: "http://localhost:3000,https://yoursite.com," })
});

const app = express();
const PORT = env.PORT;

// Initialize cache with a TTL of 10 minutes (600 seconds)
const cache = new NodeCache({ stdTTL: 600 });

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 100 requests per windowMs
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

// Origin lock middleware
const allowedOrigins = env.ALLOWED_ORIGINS.split(',');
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow requests with no Origin header (e.g., direct API calls)
  if (!origin) {
    return next();
  }

  // Check if the origin is allowed
  const isAllowed = allowedOrigins.some(allowedOrigin => {
    // Exact match
    if (origin === allowedOrigin) return true;

    // Wildcard subdomain match (e.g., *.tohost.site)
    if (allowedOrigin.startsWith('*.')) {
      const domain = allowedOrigin.replace('*.', '');
      return origin.endsWith(domain);
    }

    return false;
  });

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  } else {
    res.status(403).json({ error: "Origin not allowed" });
  }
});

// Handle CORS preflight requests
app.options('*', (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Proxy endpoint with caching
app.get('/api/v1/streamingProxy', async (req, res) => {
  const url = req.query.url;
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
    const response = await fetchWithCustomReferer(url);
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
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
      });
      return res.send(modifiedPlaylist);
    } else {
      const arrayBuffer = await response.arrayBuffer();

      // Cache the response
      cache.set(url, Buffer.from(arrayBuffer));

      res.set({
        "Content-Type": "video/mp2t",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
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
