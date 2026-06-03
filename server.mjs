import http from "node:http";
import { readFile } from "node:fs/promises";

const SOURCES = [
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  "https://test-streams.mux.dev/test_001/stream.m3u8",
  "https://test-streams.mux.dev/pts_shift/master.m3u8",
];

async function resolveToMediaPlaylist(url) {
  const text = await fetch(url).then((r) => r.text());
  if (!text.includes("#EXT-X-STREAM-INF")) return { url, text };
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
  return resolveToMediaPlaylist(new URL(lines[i + 1].trim(), url).href);
}

async function segmentsOf(src) {
  const { url, text } = await resolveToMediaPlaylist(src);
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("#EXTINF") || (l && !l.startsWith("#")))
    .map((l) => (l.startsWith("#") ? l : new URL(l, url).href))
    .join("\n");
}

http
  .createServer(async (req, res) => {
    if (req.url === "/playlist.m3u8") {
      const parts = await Promise.all(SOURCES.map(segmentsOf));
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-TARGETDURATION:11", "#EXT-X-PLAYLIST-TYPE:VOD"]
          .concat(parts.join("\n#EXT-X-DISCONTINUITY\n"))
          .concat("#EXT-X-ENDLIST")
          .join("\n"),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(await readFile(new URL("./index.html", import.meta.url)));
  })
  .listen(4173, () => console.log("http://localhost:4173"));
