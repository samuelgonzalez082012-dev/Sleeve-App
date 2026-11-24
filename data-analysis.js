'use strict';

(function exposeLocalDataAnalysis(root) {
  const MAX_INPUT_CHARACTERS = 500_000;
  const MAX_ROWS = 10_000;
  const MAX_COLUMNS = 100;
  const MAX_CATEGORIES = 10;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"' && cell.length === 0) quoted = true;
      else if (character === ',') { row.push(cell); cell = ''; }
      else if (character === '\n' || character === '\r') {
        if (character === '\r' && text[index + 1] === '\n') index++;
        row.push(cell); cell = '';
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
      } else cell += character;
    }
    if (quoted) throw new Error('CSV contains an unclosed quoted field.');
    row.push(cell);
    if (row.some(value => value !== '')) rows.push(row);
    if (rows.length < 2) throw new Error('CSV must include a header row and at least one data row.');
    const headers = rows[0].map((value, index) => value.trim().slice(0, 120) || `column_${index + 1}`);
    const seen = new Set();
    for (const header of headers) {
      const normalized = header.toLowerCase();
      if (seen.has(normalized)) throw new Error(`CSV has a duplicate column name: ${header}`);
      seen.add(normalized);
    }
    return {
      headers,
      rows: rows.slice(1, MAX_ROWS + 1).map(values => headers.map((_, index) => String(values[index] ?? '').trim())),
      truncated: rows.length - 1 > MAX_ROWS
    };
  }

  function normalizeRecords(value) {
    const records = Array.isArray(value) ? value : value && Array.isArray(value.data) ? value.data : null;
    if (!records || !records.length || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new Error('JSON input must be a non-empty array of objects (or an object with a data array).');
    }
    const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
    if (!headers.length) throw new Error('JSON records do not contain any columns.');
    if (headers.length > MAX_COLUMNS) throw new Error(`Data exceeds the ${MAX_COLUMNS}-column limit.`);
    return {
      headers,
      rows: records.slice(0, MAX_ROWS).map(record => headers.map(header => {
        const value = record[header];
        return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      })),
      truncated: records.length > MAX_ROWS
    };
  }

  function summarizeColumn(name, values) {
    const present = values.filter(value => value !== '');
    const numbers = present.map(Number);
    if (present.length && numbers.every(Number.isFinite)) {
      const sorted = numbers.slice().sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return {
        name, type: 'number', count: numbers.length, missing: values.length - present.length,
        min: sorted[0], max: sorted[sorted.length - 1],
        mean: numbers.reduce((mean, value) => mean + value / numbers.length, 0),
        median: sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2
      };
    }
    const frequencies = new Map();
    for (const value of present) frequencies.set(value, (frequencies.get(value) || 0) + 1);
    return {
      name, type: 'text', count: present.length, missing: values.length - present.length, unique: frequencies.size,
      topValues: [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_CATEGORIES).map(([value, count]) => ({ value: value.slice(0, 120), count }))
    };
  }

  function analyzeTabularData(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Provide CSV or JSON data to analyze.');
    if (input.length > MAX_INPUT_CHARACTERS) throw new Error(`Input exceeds the ${MAX_INPUT_CHARACTERS.toLocaleString()} character limit.`);
    const trimmed = input.trim();
    const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    let table;
    if (isJson) {
      let parsed;
      try { parsed = JSON.parse(trimmed); }
      catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
      table = normalizeRecords(parsed);
    } else table = parseCsv(trimmed);
    if (table.headers.length > MAX_COLUMNS) throw new Error(`Data exceeds the ${MAX_COLUMNS}-column limit.`);
    return {
      format: isJson ? 'json' : 'csv', rows: table.rows.length,
      columns: table.headers.map((header, index) => summarizeColumn(header, table.rows.map(row => row[index]))),
      truncated: table.truncated
    };
  }

  const api = Object.freeze({ analyzeTabularData });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LocalDataAnalysis = api;
})(typeof window === 'undefined' ? globalThis : window);
