# Find Music changelog

## Premium-free public metadata + Exportify playlist import

- Removed the Find Music UI dependency on authenticated Spotify Web API calls, Client ID setup, and Spotify OAuth token exchange.
- Added Spotify public oEmbed metadata for track/album link identification and public Apple Search/Lookup metadata for track candidates and album track lists.
- Spotify playlist URLs now request an Exportify CSV instead of calling authenticated Spotify playlist endpoints.
- Added robust CSV parsing for quoted delimiters/newlines, UTF-8 BOM, Exportify field aliases, duration, ISRC, album URI, and track order; no additional package dependency is required.
- Added read-only local library comparison, ISRC-first duplicate matching, title/artist/duration fallback, and duplicate-row suppression within imported lists.
- Added one main Download Audio action, one best eligible download source per requested track, per-track status indicators, progress reporting, cancellation, automatic import, and ZIP reveal action.
- Added an album track lookup action when a public collection ID or Exportify Album URI is available.
- Preserved the existing Find Music manual search, folder watching, direct-download search, and other Sleeve functionality under the Advanced disclosure.
- Upgraded installer cleanup to unload old Spotify-auth UI scripts, remove old Find Music Web API bridge methods/registration, add the public metadata IPC bridge, expose library metadata only within the renderer, and keep backups/idempotent re-installation.
- No new npm dependencies.

## Download-source limitations

- Direct download resolution remains limited to source files available through the existing Internet Archive explicit-license workflow. A metadata match is not evidence that an audio download is available.
- No stream ripping, DRM bypass, or store-checkout bypass was introduced.

## YouTube reference support

- Accepts YouTube / YouTube Music video URLs (watch, youtu.be, shorts, embed, and live URL forms).
- Uses YouTube's official oEmbed endpoint for public video title, channel and thumbnail metadata, then matches the recording against the public music catalog.
- Recognizes YouTube playlist URLs and explains that they need a CSV track list in this version.
- Does not extract, rip, or download YouTube audio; direct downloads continue to use the separately supported source and eligibility checks.
- Adds tests for URL parsing, video metadata matching, playlist handling, and invalid hosts.


## Local FFmpeg conversion

- Added a dedicated local media conversion card under Find Music.
- Supports user-selected audio/video sources; MP3 extracts the source audio and MP4 transcodes a selected video to H.264/AAC.
- Locates FFmpeg from `FFMPEG_PATH`, the current `PATH`, app-local locations, or a user-selected executable. A selected executable path is remembered in app data.
- Shows conversion progress, supports cancellation, writes outputs to `Music/Sleeve Converted`, imports completed outputs up to 300 MB into the existing Sleeve library pipeline, and provides a reveal action for larger outputs.
- Added “Find YouTube reference”: a Spotify track/album link can generate a YouTube search using public catalog metadata; a pasted YouTube URL opens as an external reference. No embedded browser is added.
- No YouTube stream extraction/download, DRM bypass, or store-checkout bypass is included. A YouTube URL is not itself a local input file; for videos the user owns, use YouTube Studio's official MP4 download then select that file in Sleeve.
- Added conversion argument, path-sanitization, progress parsing, and installer regression tests.
