const fetch = require('node-fetch');

async function fetchWithCustomReferer(url) {
  if (!url) throw new Error("URL is required");
  return fetch(url, {
    headers: {
      "Referer": "https://megacloud.club/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Origin": "https://megacloud.club/",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
    },
  });
}

module.exports = { fetchWithCustomReferer };