# Sleeve Music Player

Sleeve is a desktop music player built with Electron, HTML, CSS, and JavaScript.

The goal of Sleeve is to provide a music player that is 100% free. so you dont have to pay for the features on Spotify Premium (and Sleeve even some features not on Spotify Premium)

## Features

### Local Music Library

Sleeve is designed primarily for playing music stored locally on your computer.

Features include:

* Browse your local music library
* Search for songs
* Play, pause, and skip tracks
* Previous and next track controls
* Album organization
* Artist organization
* Track metadata
* Album artwork
* Now Playing interface
* Local file playback
* Import music folders

---

## Music Import

Sleeve can import music from folders on your computer.

This allows you to add an existing music collection without manually adding every song individually.

Once music has been imported, it can be browsed and played through the Sleeve library.

---

## Playlists

Sleeve supports playlists for organizing music.

You can:

* Create playlists
* Add songs to playlists
* View songs inside playlists
* Play songs from playlists
* Organize music into different collections

When selecting a song from a playlist, the playlist can become the current playback context.

---

## Albums

Sleeve organizes music by album.

When selecting a song from an album, the playback queue can be changed to the songs belonging to that album.

This makes it possible to listen through an album without manually adding every song to the queue.

---

## Artists

Sleeve includes an Artists section for browsing music by artist.

This makes it easier to find music when you have a large local library.

---

# Queue System

Sleeve uses a context-based queue system.

When you select a song from an album or playlist, the queue is replaced with the songs from that album or playlist.

For example:

```text
Playlist
├── Song 1
├── Song 2
├── Song 3
└── Song 4
```

Selecting Song 2 makes the playlist the current playback context:

```text
Queue
├── Song 1
├── Song 2
├── Song 3
└── Song 4
```

Sleeve also supports manually adding individual songs to the queue.

Manually adding a song does not replace the existing queue.

---

# Equalizer

Sleeve includes a built-in audio equalizer.

The equalizer provides controls for different parts of the frequency range.

Current controls include:

* Bass
* Mids
* Treble
* EQ presets
* Reset EQ

The EQ system can also be used alongside stem separation for more detailed audio control.

---

## EQ Presets

Sleeve supports EQ presets that allow you to quickly change the sound of your music.

You can use a preset instead of manually adjusting every EQ control.

The reset option returns the equalizer to its default settings.

---

# AI Stem Separation

Sleeve includes Demucs integration for separating songs into individual stems.

Demucs is an AI-based music source-separation system.

Sleeve can separate a song into:

* Vocals
* Drums
* Bass
* Other

A song can therefore be separated into:

```text
Song
├── Vocals
├── Drums
├── Bass
└── Other
```

These individual stems can then be used for additional audio control.

---

## Stem Controls

After a song has been separated into stems, Sleeve can work with the individual stems instead of treating the song as a single audio source.

This allows individual parts of the song to have their own volume controls.

For example:

```text
Vocals   ─────────●────
Drums    ───────●──────
Bass     ──────────●───
Other    ────────●─────
```

---

# Demucs Setup

The Demucs runtime is not included in the GitHub repository.

This is intentional.

Demucs uses PyTorch, which contains very large files. Some PyTorch files can exceed GitHub's 100 MB file-size limit.

Instead, Demucs should be installed separately.


## Requirements

For Demucs functionality, you need:

* Python 3.12
* Demucs
* PyTorch
* The required Demucs dependencies

## Installing Python

Install Python 3.12 on your computer.

After installing Python, open a terminal and check the installation:

```bash
python --version
```

You should see something similar to:

```text
Python 3.12.x
```

If the `python` command is not available, make sure Python has been added to your PATH.

---

## Installing Demucs

Install Demucs using:

```bash
python -m pip install demucs
```

After installation, verify that Demucs works:

```bash
python -m demucs --help
```

If the Demucs help information appears, Demucs has been installed successfully.

---

# Development Setup

## Requirements

To work on Sleeve, you will need:

* Windows
* Node.js
* npm
* Git
* Python 3.12 for Demucs functionality

---

## Clone the Repository

Clone the Sleeve repository to your computer.

Then open a terminal in the Sleeve project directory.

The project should look approximately like this:

```text
Sleeve-App/
├── index.html
├── main.js
├── preload.js
├── renderer.js
├── package.json
├── package-lock.json
├── forge.config.js
├── Icon.ico
├── .gitignore
└── README.md
```

---

## Install Node Dependencies

Inside the Sleeve project folder, run:

```bash
npm install
```

This installs the dependencies required by the Electron application.

---

# Running Sleeve

After installing the dependencies, start Sleeve with:

```bash
npm start
```

This launches Sleeve in development mode.

---

# Python Environment

Sleeve can use a Python environment for Demucs.

The development Python executable is expected at:

```text
python/venv/Scripts/python.exe
```

The exact Python executable used by Sleeve is determined by the Python path logic in `main.js`.

If you are setting up the development environment manually, make sure the Python environment is configured according to the project's current `main.js` configuration.

---

# Building Sleeve

Sleeve uses Electron Forge for packaging and creating distributables.

First install the project dependencies:

```bash
npm install
```

Then build Sleeve with:

```bash
npm run make
```

The build process creates the distributable files configured in the Electron Forge configuration.

---

# Application Icon

Sleeve's application icon is stored in:

```text
Icon.ico
```

The Electron Forge configuration uses this icon when packaging the application.

To change the application icon:

1. Replace `Icon.ico`.
2. Keep the new file named `Icon.ico`.
3. Rebuild Sleeve.

The packaged application will then use the new icon.

---

# Project Structure

| File                | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `index.html`        | Main application interface                      |
| `renderer.js`       | Renderer-side application logic                 |
| `main.js`           | Electron main process and system functionality  |
| `preload.js`        | Secure bridge between Electron and the renderer |
| `package.json`      | Project configuration and dependencies          |
| `package-lock.json` | Locked npm dependency versions                  |
| `forge.config.js`   | Electron Forge packaging configuration          |
| `Icon.ico`          | Sleeve application icon                         |
| `.gitignore`        | Files excluded from Git                         |
| `README.md`         | Project documentation                           |

---

# Files Not Included in GitHub

Some files and folders are intentionally excluded from the repository.

These include:

```text
node_modules/
out/
dist/
python/venv/
python/embedded/
test-output/
```

These folders may contain:

* Installed Node dependencies
* Build output
* Python environments
* Large PyTorch files
* Generated Demucs audio
* Temporary files

They should not normally be committed to the repository.

After cloning Sleeve, these files can be recreated or installed using the setup instructions above.

---


# Technologies

Sleeve is built using:

* Electron
* JavaScript
* HTML
* CSS
* Node.js
* Python
* Demucs
* PyTorch

The project is primarily targeted at Windows.

---



# Demucs Notes

Stem separation is computationally intensive.

Processing time depends on factors such as:

* Song length
* Computer hardware
* CPU/GPU performance
* Available memory
* Demucs and PyTorch configuration

Stem separation can therefore take significantly longer than normal music playback.

Generated stems are audio files and can require significant storage space.

---


# About Sleeve

Sleeve is a personal desktop music-player project focused on providing a modern interface for local music while adding advanced audio features such as equalization and AI-powered stem separation.

The project is designed to continue growing with additional customization, library management, playback, and audio-processing features.

NOTE: Sleeve is not associated with pirating, although if you are committed to pirating, go nuts.
