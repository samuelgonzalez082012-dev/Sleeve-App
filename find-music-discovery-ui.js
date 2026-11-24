/* Sleeve Phase 4.3: genre-led artist discovery inside the existing Find Music panel. */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;

  function install() {
    const overlay = document.getElementById('sleeveFindMusicOverlay');
    const content = overlay && overlay.querySelector('.find-music-content');
    if (!content || document.getElementById('fmTasteDiscoverySection')) return;

    const api = window.electronAPI;
    if (!api || typeof api.findMusicDiscoverByTaste !== 'function') return;

    const section = document.createElement('section');
    section.id = 'fmTasteDiscoverySection';
    section.className = 'find-music-card fm-taste-discovery';
    section.innerHTML = `
      <div class="find-music-section-heading">
        <div>
          <h3>Discover artists from your taste</h3>
          <p>Use your most-listened genres to find artists you don't already have in your library.</p>
        </div>
        <span id="fmTasteGenreCount" class="find-music-count">Uses your top genres</span>
      </div>
      <div class="fm-taste-discovery-actions">
        <button id="fmTasteDiscoverButton" class="find-music-primary" type="button">Discover new artists</button>
        <span class="fm-taste-privacy-note">Only genre labels are sent to MusicBrainz. Your library artist list stays on this device.</span>
      </div>
      <div id="fmTasteDiscoveryStatus" class="find-music-status" role="status" aria-live="polite">Sleeve will use up to three genres from your library taste profile.</div>
      <div id="fmTasteDiscoveryResults" class="fm-taste-discovery-results" hidden></div>
      <p class="fm-taste-disclaimer">Suggestions use MusicBrainz community tags and catalog matches. Genre tags can be incomplete or broad, so treat these as starting points to explore.</p>
    `;

    content.insertBefore(section, content.firstElementChild || null);

    const button = section.querySelector('#fmTasteDiscoverButton');
    const status = section.querySelector('#fmTasteDiscoveryStatus');
    const results = section.querySelector('#fmTasteDiscoveryResults');
    const genreCount = section.querySelector('#fmTasteGenreCount');
    let requestEpoch = 0;
    let searching = false;

    function setStatus(message, kind) {
      status.textContent = message || '';
      status.className = 'find-music-status' + (kind === 'error' ? ' find-music-status-error' : kind === 'success' ? ' find-music-status-ok' : '');
    }

    function normalizeArtist(value) {
      return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function makeText(tag, className, value) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.textContent = value == null ? '' : String(value);
      return node;
    }

    function renderGroups(groups, knownArtists) {
      results.replaceChildren();
      const seen = new Set();
      let visibleCount = 0;
      for (const group of Array.isArray(groups) ? groups : []) {
        const genre = String(group && group.genre || 'Your genres');
        const candidates = (Array.isArray(group && group.artists) ? group.artists : [])
          .filter((artist) => artist && artist.id && artist.name)
          .filter((artist) => !knownArtists.has(normalizeArtist(artist.name)))
          .filter((artist) => {
            const key = String(artist.id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 6);
        if (!candidates.length) continue;

        const groupNode = document.createElement('section');
        groupNode.className = 'fm-taste-genre-group';
        groupNode.appendChild(makeText('h4', 'fm-taste-genre-title', genre));
        const list = document.createElement('div');
        list.className = 'fm-taste-artist-list';

        for (const artist of candidates) {
          visibleCount += 1;
          const card = document.createElement('article');
          card.className = 'fm-taste-artist-card';
          const details = document.createElement('div');
          details.className = 'fm-taste-artist-details';
          details.appendChild(makeText('strong', '', artist.name));
          const meta = [artist.type, artist.country, artist.beginDate ? (artist.endDate ? `${artist.beginDate}–${artist.endDate}` : `Since ${artist.beginDate}`) : '', artist.disambiguation]
            .filter(Boolean).join(' · ');
          details.appendChild(makeText('small', '', meta || 'Artist in the MusicBrainz catalog'));
          const open = document.createElement('button');
          open.type = 'button';
          open.className = 'find-music-secondary fm-taste-artist-open';
          open.textContent = 'View artist';
          open.addEventListener('click', async () => {
            try { await api.findMusicOpenUrl(artist.musicBrainzUrl); }
            catch (error) { setStatus(error && error.message ? error.message : 'Could not open the artist profile.', 'error'); }
          });
          card.append(details, open);
          list.appendChild(card);
        }

        groupNode.appendChild(list);
        results.appendChild(groupNode);
      }

      results.hidden = false;
      if (!visibleCount) {
        results.appendChild(makeText('div', 'find-music-empty', 'No new artists were found for these genres. Your library may already cover the catalog matches, or MusicBrainz may have limited tags for these genres.'));
      }
      return visibleCount;
    }

    button.addEventListener('click', async () => {
      if (searching) return;
      const playerApi = window.__sleevePlayerApi;
      const profile = playerApi && typeof playerApi.getTasteProfile === 'function' ? playerApi.getTasteProfile() : null;
      const genres = profile && Array.isArray(profile.genres)
        ? profile.genres.slice(0, 3).map((item) => String(item && item.name || '').trim()).filter(Boolean)
        : [];
      if (!genres.length) {
        setStatus('Sleeve could not find genre tags in your library yet. Add or update genre metadata, then try again.', 'error');
        results.hidden = true;
        return;
      }

      const knownArtists = new Set(
        playerApi && typeof playerApi.getLibraryArtistNames === 'function'
          ? playerApi.getLibraryArtistNames().map(normalizeArtist).filter(Boolean)
          : (profile && Array.isArray(profile.artists) ? profile.artists.map((item) => normalizeArtist(item && item.name)).filter(Boolean) : [])
      );
      const currentEpoch = ++requestEpoch;
      searching = true;
      button.disabled = true;
      button.textContent = 'Discovering…';
      genreCount.textContent = `${genres.length} genres`;
      results.replaceChildren();
      results.hidden = true;
      setStatus(`Searching MusicBrainz for artists tagged with ${genres.join(', ')}. This may take a few seconds.`);
      try {
        const response = await api.findMusicDiscoverByTaste({ genres });
        if (currentEpoch !== requestEpoch || overlay.hidden) return;
        const count = renderGroups(response && response.genres, knownArtists);
        setStatus(count
          ? `Found ${count} artist suggestion${count === 1 ? '' : 's'} outside your local library.`
          : 'Search completed, but no new artist suggestions matched. Try refreshing your genre tags later.', count ? 'success' : 'info');
      } catch (error) {
        if (currentEpoch !== requestEpoch || overlay.hidden) return;
        setStatus(error && error.message ? error.message : 'Artist discovery failed. Check your connection and try again.', 'error');
      } finally {
        if (currentEpoch === requestEpoch) {
          searching = false;
          button.disabled = false;
          button.textContent = 'Discover new artists';
        }
      }
    });

    document.addEventListener('sleeve:find-music-reset', () => {
      requestEpoch += 1;
      searching = false;
      button.disabled = false;
      button.textContent = 'Discover new artists';
      genreCount.textContent = 'Uses your top genres';
      results.replaceChildren();
      results.hidden = true;
      setStatus('Sleeve will use up to three genres from your library taste profile.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
