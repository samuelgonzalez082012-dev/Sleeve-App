'use strict';

const ALLOWED_HOSTS = new Set([
  'open.spotify.com', 'spotify.com', 'www.spotify.com',
  'music.youtube.com', 'youtube.com', 'www.youtube.com', 'youtu.be',
  'music.apple.com', 'apple.com', 'www.apple.com',
  'music.amazon.com', 'amazon.com', 'www.amazon.com',
  'tidal.com', 'www.tidal.com', 'listen.tidal.com',
  'qobuz.com', 'www.qobuz.com',
  'deezer.com', 'www.deezer.com', 'link.deezer.com',
  'bandcamp.com', 'www.bandcamp.com',
  'freemusicarchive.org', 'www.freemusicarchive.org',
  'jamendo.com', 'www.jamendo.com',
  'archive.org', 'www.archive.org',
  '7digital.com', 'www.7digital.com',
  'prostudiomasters.com', 'www.prostudiomasters.com',
  'musicbrainz.org', 'www.musicbrainz.org'
]);

const PROVIDERS = {
  bandcamp: {
    id: 'bandcamp', name: 'Bandcamp',
    description: 'Artist-direct purchases; formats and free/pay-what-you-want options vary by release.',
    formatNote: 'FLAC / ALAC may be offered; check the release page.',
    url: (q) => `https://bandcamp.com/search?q=${encodeURIComponent(q)}`,
    freeRank: 3, losslessRank: 2, cheapRank: 2
  },
  qobuz: {
    id: 'qobuz', name: 'Qobuz Download Store',
    description: 'Paid permanent downloads; availability varies by country and release.',
    formatNote: 'FLAC / high-resolution options may be offered; verify the listing.',
    url: (q) => `https://www.qobuz.com/us-en/search?q=${encodeURIComponent(q)}`,
    freeRank: 5, losslessRank: 1, cheapRank: 4
  },
  fma: {
    id: 'fma', name: 'Free Music Archive',
    description: 'Free catalog with track-specific licenses and restrictions.',
    formatNote: 'Formats and license differ per recording; inspect the page.',
    url: (q) => `https://freemusicarchive.org/search/?quicksearch=${encodeURIComponent(q)}`,
    freeRank: 1, losslessRank: 5, cheapRank: 1
  },
  jamendo: {
    id: 'jamendo', name: 'Jamendo',
    description: 'Independent music; download rights and licenses vary by track.',
    formatNote: 'Check the track page for the permitted download and use.',
    url: (q) => `https://www.jamendo.com/search?q=${encodeURIComponent(q)}`,
    freeRank: 2, losslessRank: 4, cheapRank: 2
  },
  archive: {
    id: 'archive', name: 'Internet Archive Audio',
    description: 'Community collections; item permissions and file formats vary.',
    formatNote: 'Check item details and rights before downloading.',
    url: (q) => `https://archive.org/search?query=${encodeURIComponent(q)}`,
    freeRank: 4, losslessRank: 3, cheapRank: 3
  },
  sevenDigital: {
    id: 'sevenDigital', name: '7digital',
    description: 'Digital music store; region and release availability vary.',
    formatNote: 'Check the listing for actual format and resolution.',
    url: (q) => `https://www.7digital.com/search?q=${encodeURIComponent(q)}`,
    freeRank: 6, losslessRank: 3, cheapRank: 3
  },
  proStudioMasters: {
    id: 'proStudioMasters', name: 'ProStudioMasters',
    description: 'High-resolution download store; catalog varies.',
    formatNote: 'Check the release for actual formats and sample rates.',
    url: (_q) => 'https://www.prostudiomasters.com/',
    freeRank: 7, losslessRank: 2, cheapRank: 5
  }
};

function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (ALLOWED_HOSTS.has(host)) return true;
  // Permit only genuine subdomains of explicitly trusted provider domains.
  return [
    'spotify.com', 'youtube.com', 'apple.com', 'amazon.com', 'tidal.com',
    'qobuz.com', 'deezer.com', 'bandcamp.com', 'freemusicarchive.org',
    'jamendo.com', 'archive.org', '7digital.com', 'prostudiomasters.com',
    'musicbrainz.org'
  ].some((domain) => host.endsWith(`.${domain}`));
}

function parseReferenceLink(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a supported music link first.');

  const uri = raw.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
  if (uri) {
    return {
      service: 'Spotify',
      type: uri[1].toLowerCase(),
      id: uri[2],
      url: `https://open.spotify.com/${uri[1].toLowerCase()}/${uri[2]}`,
      metadataLookup: 'manual-reference'
    };
  }

  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new Error('That does not look like a valid URL.'); }

  if (parsed.protocol !== 'https:') {
    throw new Error('Use an HTTPS music link.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Links that contain embedded usernames or passwords are not accepted.');
  }
  if (!isAllowedHost(parsed.hostname)) {
    throw new Error('This domain is not on Sleeve’s supported music-link list.');
  }

  const host = parsed.hostname.toLowerCase();
  let service = 'Music service';
  if (host.includes('spotify')) service = 'Spotify';
  else if (host.includes('youtube') || host === 'youtu.be') service = 'YouTube Music / YouTube';
  else if (host.includes('apple')) service = 'Apple Music';
  else if (host.includes('amazon')) service = 'Amazon Music';
  else if (host.includes('tidal')) service = 'TIDAL';
  else if (host.includes('qobuz')) service = 'Qobuz';
  else if (host.includes('deezer')) service = 'Deezer';
  else if (host.includes('bandcamp')) service = 'Bandcamp';
  else if (host.includes('freemusicarchive')) service = 'Free Music Archive';
  else if (host.includes('jamendo')) service = 'Jamendo';
  else if (host.includes('archive.org')) service = 'Internet Archive';
  else if (host.includes('7digital')) service = '7digital';
  else if (host.includes('prostudiomasters')) service = 'ProStudioMasters';
  else if (host.includes('musicbrainz')) service = 'MusicBrainz';

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const typeWord = pathSegments.find((part) => /^(track|album|playlist|release|recording|song|artist|channel|watch)$/i.test(part));
  const type = typeWord ? typeWord.toLowerCase() : 'link';
  const id = parsed.searchParams.get('v') || pathSegments[pathSegments.length - 1] || '';

  return {
    service,
    type,
    id: id.slice(0, 160),
    url: parsed.href,
    metadataLookup: service === 'Spotify' ? 'manual-reference' : 'reference-only'
  };
}

function cleanIsrc(value) {
  const isrc = String(value || '').replace(/[-\s]/g, '').toUpperCase();
  if (!isrc) return '';
  if (!/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc)) {
    throw new Error('ISRC should be 12 characters, for example USABC2300001.');
  }
  return isrc;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(value) {
  return normalizeText(value)
    .replace(/\s*\b(?:19|20)\d{2}\s+remaster(?:ed)?\b\s*$/i, '')
    .replace(/\s*\bremaster(?:ed)?\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  // Dice coefficient over character bigrams; small and dependency-free.
  const grams = (str) => {
    const s = ` ${str} `;
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const item = s.slice(i, i + 2);
      out.set(item, (out.get(item) || 0) + 1);
    }
    return out;
  };
  const aGrams = grams(left);
  const bGrams = grams(right);
  let overlap = 0;
  for (const [gram, count] of aGrams) {
    overlap += Math.min(count, bGrams.get(gram) || 0);
  }
  const total = [...aGrams.values()].reduce((sum, n) => sum + n, 0)
    + [...bGrams.values()].reduce((sum, n) => sum + n, 0);
  return total ? (2 * overlap) / total : 0;
}

function editionFlags(value) {
  const text = normalizeText(value);
  const markers = {
    live: /\blive\b/,
    remaster: /\bremaster(?:ed)?\b/,
    remix: /\bremix(?:ed)?\b/,
    acoustic: /\bacoustic\b/,
    instrumental: /\binstrumental\b/,
    demo: /\bdemo\b/,
    radioEdit: /\bradio edit\b/,
    spedUp: /\bsped up\b/,
    slowed: /\bslowed\b/,
    karaoke: /\bkaraoke\b/
  };
  return new Set(Object.entries(markers).filter(([, re]) => re.test(text)).map(([name]) => name));
}

function scoreRecording(source, candidate) {
  const sourceIsrc = String(source.isrc || '').toUpperCase().trim();
  const candidateIsrcs = (candidate.isrcs || []).map((x) => String(x).toUpperCase().trim());
  const exactIsrc = !!sourceIsrc && candidateIsrcs.includes(sourceIsrc);

  const titleScore = similarity(baseTitle(source.title), baseTitle(candidate.title));
  const artistScore = similarity(source.artist, candidate.artist);
  const albumScore = (source.album && candidate.album)
    ? similarity(source.album, candidate.album)
    : 0.5;
  const sourceDuration = Number(source.durationSec) || null;
  const candidateDuration = Number(candidate.durationSec) || null;
  let durationScore = 0.5;
  if (sourceDuration && candidateDuration) {
    const tolerance = Math.min(8, Math.max(3, Math.max(sourceDuration, candidateDuration) * 0.02));
    durationScore = Math.max(0, 1 - Math.abs(sourceDuration - candidateDuration) / tolerance);
  }

  let score = 0.45 * titleScore + 0.30 * artistScore + 0.15 * durationScore + 0.10 * albumScore;
  const differences = new Set([...editionFlags(source.title), ...editionFlags(candidate.title)]);
  for (const flag of editionFlags(source.title)) {
    if (editionFlags(candidate.title).has(flag)) differences.delete(flag);
  }
  if (differences.has('remaster') && differences.size === 1) score -= 0.08;
  else if (differences.size) score -= 0.22;
  if (exactIsrc) score = Math.max(score, 0.97);

  return {
    score: Math.max(0, Math.min(1, score)),
    exactIsrc,
    components: { title: titleScore, artist: artistScore, album: albumScore, duration: durationScore }
  };
}

function makeProviderLinks(metadata, preference = 'free') {
  const query = [metadata.title, metadata.artist].filter(Boolean).join(' ').trim();
  const rankKey = preference === 'lossless' ? 'losslessRank'
    : preference === 'cheapest' ? 'cheapRank' : 'freeRank';
  return Object.values(PROVIDERS)
    .map((provider) => ({
      // Return only plain data across Electron IPC. The provider's `url` member
      // is a function used to build the search URL and cannot be structured-cloned.
      id: provider.id,
      name: provider.name,
      description: provider.description,
      formatNote: provider.formatNote,
      searchUrl: provider.url(query),
      ranking: preference === 'all' ? 0 : provider[rankKey]
    }))
    .sort((a, b) => a.ranking - b.ranking || a.name.localeCompare(b.name))
    .map(({ ranking, ...provider }) => provider);
}

module.exports = {
  ALLOWED_HOSTS,
  PROVIDERS,
  isAllowedHost,
  parseReferenceLink,
  cleanIsrc,
  normalizeText,
  baseTitle,
  similarity,
  scoreRecording,
  makeProviderLinks
};
