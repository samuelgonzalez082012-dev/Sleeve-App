# Sleeve spotDL integration (drop-in files)

This adds a **Download Spotify link** button to Sleeve. It runs spotDL from Sleeve's Electron main process, keeps command execution out of the renderer, shows downloader output, supports cancellation, and saves MP3s to the user's Music folder under `Sleeve Downloads`.

## Before starting

1. Close Sleeve.
2. Make a separate copy of your Sleeve project folder or ensure it is committed in Git.
3. Extract all the files from this package into the **root of the Sleeve project**, beside `main.js`, `preload.js`, and `index.html`.
4. Open PowerShell in that project folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-spotdl-integration.ps1
   ```

The installer checks the expected files, makes timestamped backups under `backups`, and adds small integrations to `main.js`, `preload.js`, and `index.html`. It will refuse to run if it detects that the integration is already installed or your files differ from the expected layout. It validates required imports without requiring exact whitespace or quote formatting, then makes timestamped backups before changing the three app files. It does not overwrite the new JS/CSS files.

## Install spotDL on Windows

Install Python first if needed. Then run these commands in PowerShell:

```powershell
python -m pip install --user --upgrade spotdl
python -m spotdl --download-ffmpeg
python -m spotdl --download-deno
```

If `python` is not recognized but the Python launcher `py` works, replace `python` with `py` in those commands. If neither command works, install Python from the [official Windows downloads page](https://www.python.org/downloads/windows/) and enable **Add Python to PATH**, then close and reopen Command Prompt/PowerShell. Restart Sleeve after installing. The app checks the `spotdl` command and Python-based launchers. See the official [spotDL installation guide](https://spotdl.github.io/spotify-downloader/installation/) if setup fails.

## Use it

1. Run Sleeve.
2. Click **Download Spotify link** in the left sidebar.
3. Paste a Spotify track, album, artist, or playlist link and click **Download**.
4. Keep Sleeve open until the task finishes. The output is shown in the dialog; the Cancel button attempts to stop the process.
5. Completed MP3s are stored at `%USERPROFILE%\Music\Sleeve Downloads` on a default Windows setup. Click **Open download folder** to view them, or **Import into Sleeve** to use Sleeve's existing Add folder picker and add the folder to your library.

## Notes and limitations

- This uses an installed spotDL CLI; it does not bundle Python, FFmpeg, or spotDL inside Sleeve's packaged installer.
- spotDL uses Spotify metadata to search for a matching audio source; it does not extract Spotify's protected stream. A result may be unavailable or may not be the exact recording, so check matches before using them.
- Only HTTPS links on recognized Spotify domains are accepted by the UI and revalidated in the Electron main process. The URL is passed as a process argument with `shell: false`, not interpreted as a shell command.
- Downloads are MP3 to keep compatibility with Sleeve. The feature intentionally doesn't modify Sleeve's playback queue or add opaque file objects to the library automatically; after download, use **Import into Sleeve** so the existing library importer owns that workflow.
- If a process gets stuck during cancellation, close Sleeve and check whether a leftover spotDL/Python process remains. Cancellation behavior depends on the operating system and subprocesses used by spotDL.
- This package has been syntax-checked locally, but it cannot fully exercise a real spotDL download without your Windows environment, installed dependencies, network access, and an actual Spotify link.

## Rollback

Close Sleeve, then copy the backed-up `main.js`, `preload.js`, and `index.html` from the timestamped folder inside `backups` over the current files. Remove `spotdl-integration.js` and `spotdl-integration.css` if you no longer need them. Your downloads are not deleted.
