# Sleeve Find Music — Premium-Free Link + Exportify Workflow

This patch updates the focused Find Music workflow so it does not use Spotify's authenticated Web API or require a Spotify login/Client ID inside Sleeve. It adds a polished paste-link / import-playlist interface, public Spotify/YouTube-reference metadata lookup, playlist CSV parsing, local-library duplicate checks, and a single **Download Audio** action for eligible downloads.

## Important capability notes

- **No new npm dependencies.** It uses Electron/Node APIs already available in Sleeve and the browser's built-in CSV file input.
- **Spotify track and album links:** Sleeve calls Spotify's public oEmbed endpoint for the link title/thumbnail, then uses Apple's public Search/Lookup catalog to identify a plausible track or retrieve an album track list. Neither step uses a Spotify login or Spotify Web API token.
- **YouTube video links:** Sleeve accepts public YouTube and YouTube Music video URLs, reads their public title/channel/thumbnail via YouTube oEmbed, and uses that text as a reference to identify a recording in the public music catalog. YouTube playlist links are recognized but need a CSV track list. This integration does not download or extract YouTube audiovisual content; Download Audio still uses the independently supported direct-download resolver and its license checks.
- **Spotify playlist links:** a public link preview does not contain a playlist's track list. Paste the playlist URL as a reference if helpful, then choose the playlist's **Exportify CSV**. Sleeve reads the file locally and does not call Spotify to retrieve its tracks.
- **Download source limitation:** the current direct-download resolver is limited to Internet Archive items whose metadata declares a supported Creative Commons or public-domain license and whose audio file passes Sleeve's match checks. It will report tracks as not found when no sufficiently strong eligible file is available. It does not rip Spotify/YouTube streams, bypass purchase access, or promise that every commercial song can be downloaded.
- **Local MP3/MP4 conversion:** Find Music includes a separate FFmpeg converter for media files explicitly selected from disk. It can extract audio to MP3 from a suitable audio/video file or transcode a video file to MP4. Sleeve looks for FFmpeg on `PATH` or in app-local locations; otherwise use **Locate FFmpeg** to select the executable. The selected path is remembered in the user's app-data folder. Output is written to `Music/Sleeve Converted`. Outputs up to 300 MB are automatically imported; larger outputs are saved and can be revealed in Explorer. This converter does not download media from a YouTube page URL.
- **YouTube reference search:** For a Spotify track/album link, use **Find YouTube reference** to build a YouTube search from its public catalog metadata. YouTube links can also be resolved as reference metadata. For a video you uploaded, use YouTube Studio's official download and then select the local MP4 in Sleeve for conversion.
- **Premium note:** Sleeve's track/album link lookup and CSV processing don't require Spotify Premium. Exportify itself is a separate service; its ability to create a fresh export can depend on its own Spotify authentication and Spotify's current access rules.
- **Limits:** up to 200 tracks per collection ZIP, a 480 MB total ZIP cap, a 300 MB per-audio-file limit, and a 10 MB CSV input limit. Large playlists should be split into CSVs.

Spotify documents oEmbed as a way to display basic link metadata, such as an entity title and thumbnail; it is not the playlist-track API: <https://developer.spotify.com/documentation/embeds/reference/oembed>.

## User workflow

1. Open **Find Music**.
2. For one track or album, paste its Spotify URL, or paste a YouTube video URL as a recording reference, then click **Resolve** (or paste it to resolve automatically).
3. If the public catalog finds multiple plausible artists/releases, choose the correct one. This ambiguity check avoids silently selecting a different song with the same title.
4. For a playlist, choose **Import Playlist File** and select a UTF-8 Exportify `.csv` or another CSV with `Title` and `Artist` columns. YouTube playlist URLs are recognized as references but are not enumerated automatically in this build.
5. Sleeve compares parsed tracks to the current local library. Matching title + artist is checked, and duration is used when both sides have it. Matching ISRC values are preferred when both are present. Same-list duplicates are marked and not downloaded twice.
6. Click **Download Audio**. Sleeve resolves eligible Internet Archive audio files, downloads at concurrency 2, imports successful audio into the existing Sleeve library pipeline, and packages successful downloads into one ZIP in `Music/Sleeve Downloads`.
7. Click **Show ZIP in folder** to reveal the archive. Individual audio files are saved separately and added to the library; the ZIP is an additional bundle.
8. For local conversion, scroll to **Make an MP3 or MP4**, choose a source media file, configure FFmpeg if prompted, choose MP3 or MP4, and click **Convert & Import**. MP3 works with audio/video sources; MP4 requires a video source. The converter shows progress and saves the result to `Music/Sleeve Converted` before importing outputs that are within the 300 MB limit.

The **Fetch Whole Album** action uses the public album collection ID when available. For CSV tracks, it can use the Exportify `Album URI` to resolve the album's public metadata.

## Installation

1. Close Sleeve completely.
2. Extract the patch ZIP.
3. Open PowerShell in the extracted `Sleeve-Find-Music-Patch` directory.
4. Run the installer (use the actual path to the root of your Sleeve project):

   ```powershell
   node .\install-find-music.js "C:\Users\samue\Coding\Sleeve-App"
   ```

5. Start Sleeve from the project directory:

   ```powershell
   npm start
   ```

If Sleeve reports that FFmpeg is missing, install FFmpeg from the official download page at https://ffmpeg.org/download.html, then use **Locate FFmpeg** to select `ffmpeg.exe` (typically inside the Windows build's `bin` folder).

The installer backs up every modified integration file before writing it. The integration is modular: it adds two UI modules and one public metadata main-process module, narrows the preload bridge to explicit IPC methods, and adds a read-only library snapshot event plus the existing import-files event in `renderer.js`. It does not alter playback, playlists, EQ, stems, lyrics, or other unrelated feature code.

## Tests

Run from the extracted patch folder:

```powershell
node .\test-find-music-core.js
node .\test-find-music-main.js
node .\test-find-music-watch.js
node .\test-find-music-download-main.js
node .\test-find-music-inapp-download.js
node .\test-find-music-import-core.js
node .\test-find-music-public-metadata.js
node .\test-find-music-import-ui.js
node .\test-find-music-installer.js
node .\test-find-music-youtube.js
node .\test-find-music-convert.js
```

These tests cover parsing and duplicate detection, public-link metadata requests with mocked responses, download matching/ZIP behavior, script/IPC wiring, and repeat installation. They do not replace a manual run inside your actual Sleeve environment or confirm that a particular Internet Archive item has correctly declared rights.

## Files added/changed by installer

- `find-music-import-core.js`: CSV parsing, normalization, and library duplicate checks.
- `find-music-public-metadata-main.js`: Spotify oEmbed, YouTube oEmbed video metadata + public catalog search/lookup; no Spotify token endpoints and no YouTube audio extraction.
- `find-music-import-ui.js`: focused paste/CSV UI, result states, progress, download and ZIP action.
- `find-music-convert-main.js` and `find-music-convert-ui.js`: local FFmpeg conversion for user-selected media; MP3/MP4 output, progress/cancellation, auto-import for outputs up to 300 MB, and a reveal action for larger outputs.
- `find-music.css`: polished, responsive workflow styling.
- `main.js`: registers public metadata and existing download/watch handlers; removes the old Find Music Spotify-Web-API handler registration if an earlier patch installed it.
- `preload.js`: exposes public metadata methods and removes the obsolete Find Music Spotify token/playlist/album bridge methods.
- `renderer.js`: offers a small read-only library snapshot to Find Music and sends successfully downloaded `File` objects through Sleeve's existing `addFiles()` pipeline.
- `index.html`: loads the new workflow modules and stops loading the old Find Music Spotify-auth UI.
