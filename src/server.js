require('dotenv').config();
const express = require('express');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const { fetchWithCustomReferer } = require('./fetchWithCustomReferer');
const { rewritePlaylistUrls } = require('./rewritePlaylistUrls');

const app = express();
const PORT = process.env.PORT || 4467;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Proxy endpoint
app.get('/api/v1/streamingProxy', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
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

      res.set({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
      });
      return res.send(modifiedPlaylist);
    } else {
      const arrayBuffer = await response.arrayBuffer();
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});