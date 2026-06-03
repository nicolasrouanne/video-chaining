# video-chaining

Proof of concept: chain multiple HLS videos into a single, gap-less playback
session using **server-side playlist concatenation** — not double buffering.

A Node server fetches several HLS media playlists, stitches their segments
into one unified `.m3u8` with `#EXT-X-DISCONTINUITY` markers between sources,
and the frontend plays the result with a single `<video>` + `hls.js`. The
gap-less chaining is native to HLS — no JavaScript swap logic, no second
hidden player.

## Quick start

```sh
node server.mjs    # Node ≥ 18 (relies on native fetch)
open http://localhost:4173
```

## How it works

```
SOURCES ──┐
          │   fetch + parse        emit master m3u8 with
          ├──► strip headers ─────► #EXT-X-DISCONTINUITY ──► /playlist.m3u8
          │   absolutize segments  between each source
SOURCES ──┘
```

`server.mjs`:

1. For each source URL, follows the master playlist down to the first variant
   (e.g. `360p/video.m3u8`)
2. Keeps `#EXTINF` lines and rewrites segment URLs to absolute
3. Joins all sources with `#EXT-X-DISCONTINUITY` between them
4. Wraps with a minimal VOD header

The browser-side `index.html` is a `<video>` element with `hls.js`
loading `/playlist.m3u8`. Nothing more.

## Production mapping

| POC                  | Production                                    |
| -------------------- | --------------------------------------------- |
| `server.mjs`         | Rails endpoint or Cloudflare Worker           |
| `SOURCES = [...]`    | `Playlist.find(id).videos.map(&:hls_url)`     |
| Mux test streams     | Your video CDN's per-video m3u8s              |
| No cache             | Redis or HTTP cache keyed by playlist id      |
| Absolute URLs        | Same — segments stay served by the video CDN  |

The server only emits the manifest (a few KB). Segments stream
directly from the video CDN, so the server stays cheap.

## Caveats

- **All sources must share compatible codecs.** Most video CDNs
  transcode uniformly, so this is fine in practice. Mixing arbitrary
  inputs may cause a brief decoder reset at each discontinuity.
- **Variant selection is hardcoded to the first one** in the master
  playlist. In production, pick a target rendition (e.g. 720p) or
  build a concatenated master with multiple ladders to preserve ABR.
- **Signed URLs** are preserved when the token is embedded in the
  path prefix, because relative URL resolution keeps the prefix
  intact. If your CDN uses query-string signing, you'll need to
  re-sign each segment URL.

## Files

- `server.mjs` — 47 lines. Node http server.
- `index.html` — 35 lines. Single `<video>` + `hls.js` from jsdelivr CDN.
