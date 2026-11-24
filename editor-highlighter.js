(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LocalEditorHighlighter = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const esc = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const keywordSets = {
    js: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of as satisfies interface type enum implements package private protected public static readonly declare abstract keyof infer is asserts',
    py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while',
    cs: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using virtual void volatile while',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    rs: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    sql: 'all alter and as asc begin between by case check column constraint create cross current_date current_time database default delete desc distinct drop else end except exists foreign from full group having in index inner insert into is join key left like limit not null offset on or order outer primary references right select set table then trigger union unique update values view when where with',
    shell: 'case coproc do done elif else esac fi for function if in select then time until while'
  };
  const constants = new Set(['true', 'false', 'null', 'undefined', 'nan', 'infinity', 'none', 'notimplemented', 'ellipsis', 'self', 'this', 'super']);
  const commonTypes = new Set(['Array', 'Boolean', 'Date', 'Error', 'Function', 'Map', 'Number', 'Object', 'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'BigInt', 'HTMLElement', 'Event', 'Node', 'console', 'Math', 'JSON', 'window', 'document']);

  function span(kind, text) {
    return '<span class="syn-' + kind + '">' + esc(text) + '</span>';
  }

  function withIndentGuides(markup) {
    return markup.replace(/^((?: {2}|\t)+)/gm, '<span class="editor-indent-guide">$1</span>') || ' ';
  }

  function highlightCode(source, language) {
    const text = String(source ?? '');
    const lang = String(language || '').toLowerCase();
    if (['html', 'htm', 'xml', 'svg', 'jsx', 'tsx'].includes(lang)) return withIndentGuides(highlightMarkup(text));
    if (['css', 'scss', 'less'].includes(lang)) return withIndentGuides(highlightStyles(text));

    const keywordSet = new Set((keywordSets[lang] || keywordSets.js).split(/\s+/));
    const pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|--[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b)|([A-Za-z_$][\w$]*)|([{}()[\].,:;])|([+\-*\/%=&|!<>?~^]+)/g;
    let result = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      result += esc(text.slice(last, match.index));
      const token = match[0];
      if (match[1]) {
        const isHashComment = token[0] === '#' && ['py', 'shell'].includes(lang);
        const isSqlComment = token.startsWith('--') && lang === 'sql';
        result += token.startsWith('/*') || token.startsWith('//') && !['py', 'shell'].includes(lang) || isHashComment || isSqlComment
          ? span('comment', token)
          : esc(token);
      } else if (match[2]) {
        const after = text.slice(pattern.lastIndex).match(/^\s*/)[0].length;
        result += lang === 'json' && text[pattern.lastIndex + after] === ':' ? span('property', token) : span('string', token);
      } else if (match[3]) {
        result += span('number', token);
      } else if (match[4]) {
        const lower = token.toLowerCase();
        const after = text.slice(pattern.lastIndex).match(/^\s*/)[0].length;
        const next = text[pattern.lastIndex + after];
        const before = text.slice(0, match.index).trimEnd();
        if (keywordSet.has(token) || keywordSet.has(lower)) result += span('keyword', token);
        else if (constants.has(token) || constants.has(lower)) result += span('constant', token);
        else if (commonTypes.has(token) || /^[A-Z]/.test(token)) result += span('type', token);
        else if (next === '(') result += span('function', token);
        else if (before.endsWith('.')) result += span('property', token);
        else if (next === ':') result += span('property', token);
        else result += span('variable', token);
      } else if (match[5]) {
        result += span('punctuation', token);
      } else {
        result += span('operator', token);
      }
      last = pattern.lastIndex;
    }
    return withIndentGuides(result + esc(text.slice(last)));
  }

  function highlightMarkup(text) {
    const pattern = /(<!--[\s\S]*?-->|<!DOCTYPE\b[^>]*>)|(<\/?[A-Za-z][\w:-]*)|(\/?>)|([\w:-]+)(?=\s*=)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(=)|(&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi;
    let result = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      result += esc(text.slice(last, match.index));
      const token = match[0];
      if (match[1]) result += span(token.startsWith('<!--') ? 'comment' : 'keyword', token);
      else if (match[2]) result += span('tag', token);
      else if (match[3]) result += span('punctuation', token);
      else if (match[4]) result += span('attribute', token);
      else if (match[5]) result += span('string', token);
      else if (match[6]) result += span('operator', token);
      else result += span('constant', token);
      last = pattern.lastIndex;
    }
    return result + esc(text.slice(last)) || ' ';
  }

  function highlightStyles(text) {
    const pattern = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(@[\w-]+)|(--[\w-]+)|(#(?:[\da-f]{3,8})\b)|(\.[\w-]+|#[\w-]+|::?[\w-]+)|(\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg)?\b)|([A-Za-z_-][\w-]*)|([{}()[\],;:])|([>+~=])/gi;
    let result = '';
    let last = 0;
    let match;
    let inBlock = false;
    while ((match = pattern.exec(text))) {
      result += esc(text.slice(last, match.index));
      const token = match[0];
      if (match[1]) result += span('comment', token);
      else if (match[2]) result += span('string', token);
      else if (match[3]) result += span('keyword', token);
      else if (match[4]) result += span('variable', token);
      else if (match[5] || match[7]) result += span('number', token);
      else if (match[6]) result += span('selector', token);
      else if (match[8]) {
        const after = text.slice(pattern.lastIndex).match(/^\s*/)[0].length;
        const next = text[pattern.lastIndex + after];
        if (next === ':') result += span('property', token);
        else if (next === '(') result += span('function', token);
        else if (next === '{') result += span('selector', token);
        else result += span(inBlock ? 'value' : 'selector', token);
      } else if (match[9]) {
        if (token === '{') inBlock = true;
        else if (token === '}') inBlock = false;
        result += span('punctuation', token);
      } else result += span('operator', token);
      last = pattern.lastIndex;
    }
    return result + esc(text.slice(last)) || ' ';
  }

  return { highlightCode };
});
