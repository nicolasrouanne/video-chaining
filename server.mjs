import http from "node:http";
import { readFile } from "node:fs/promises";

const SOURCES = [
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  "https://test-streams.mux.dev/test_001/stream.m3u8",
  "https://test-streams.mux.dev/pts_shift/master.m3u8",
];

const fetchText = (url) => fetch(url).then((r) => r.text());

// Parse a master playlist's variants. Returns [] for a media playlist.
function parseVariants(text, baseUrl) {
  const lines = text.split("\n").map((l) => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const url = new URL(lines[i + 1], baseUrl).href;
    const resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
    variants.push({ attrs: lines[i], url, resolution });
  }
  return variants;
}

// From a source URL, descend to the variant matching `resolution`.
// If the source is media-only, return as-is (used for every rendition).
async function variantOf(src, resolution) {
  const text = await fetchText(src);
  const variants = parseVariants(text, src);
  if (variants.length === 0) return { url: src, text };
  const match = variants.find((v) => v.resolution === resolution) ?? variants[0];
  return { url: match.url, text: await fetchText(match.url) };
}

// Build the concatenated media playlist for one rendition.
async function buildVariant(sources, resolution) {
  const parts = await Promise.all(
    sources.map(async (src) => {
      const { url, text } = await variantOf(src, resolution);
      return text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("#EXTINF") || (l && !l.startsWith("#")))
        .map((l) => (l.startsWith("#") ? l : new URL(l, url).href))
        .join("\n");
    }),
  );
  return ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-TARGETDURATION:11", "#EXT-X-PLAYLIST-TYPE:VOD"]
    .concat(parts.join("\n#EXT-X-DISCONTINUITY\n"))
    .concat("#EXT-X-ENDLIST")
    .join("\n");
}

// Find resolutions present in every source's master. null if any source is
// media-only or no resolution is shared.
async function commonRenditions(sources) {
  const all = await Promise.all(
    sources.map(async (src) => parseVariants(await fetchText(src), src)),
  );
  if (all.some((vs) => vs.length === 0)) return null;
  const shared = all[0].filter((v) =>
    all.every((vs) => vs.some((sv) => sv.resolution === v.resolution)),
  );
  return shared.length ? shared : null;
}

http
  .createServer(async (req, res) => {
    const qs = new URLSearchParams(req.url.split("?")[1] ?? "");
    const submitted = qs.getAll("source");
    const sources = submitted.length ? submitted : SOURCES;

    if (req.url.startsWith("/variant.m3u8")) {
      const resolution = qs.get("rendition");
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(await buildVariant(sources, resolution));
      return;
    }

    if (req.url.startsWith("/playlist.m3u8")) {
      const renditions = await commonRenditions(sources);
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      if (!renditions) {
        // No common renditions → fall back to single-rendition concat
        res.end(await buildVariant(sources, null));
        return;
      }
      // Master playlist referencing one variant per rendition
      const sourcesQs = sources.map((s) => `source=${encodeURIComponent(s)}`).join("&");
      const out = ["#EXTM3U", "#EXT-X-VERSION:6"];
      for (const r of renditions) {
        out.push(r.attrs);
        out.push(`variant.m3u8?rendition=${r.resolution}&${sourcesQs}`);
      }
      res.end(out.join("\n"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(await readFile(new URL("./index.html", import.meta.url)));
  })
  .listen(4173, () => console.log("http://localhost:4173"));
