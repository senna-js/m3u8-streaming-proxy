function rewritePlaylistUrls(playlistText, baseUrl) {
  const base = new URL(baseUrl);
  return playlistText
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") return line;

      const resolvedUrl = new URL(trimmed, base).href;
      return `/api/v1/streamingProxy?url=${encodeURIComponent(resolvedUrl)}`;
    })
    .join("\n");
}

module.exports = { rewritePlaylistUrls };