'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeTabularData } = require('../data-analysis');

test('summarizes numeric and categorical CSV columns, including quoted commas', () => {
  const result = analyzeTabularData('name,score,note\r\nAda,10,"first, item"\r\nLin,20,second\r\nAda,30,third');
  assert.equal(result.format, 'csv');
  assert.equal(result.rows, 3);
  assert.deepEqual(result.columns[1], {
    name: 'score', type: 'number', count: 3, missing: 0, min: 10, max: 30, mean: 20, median: 20
  });
  assert.deepEqual(result.columns[0].topValues[0], { value: 'Ada', count: 2 });
  assert.equal(result.truncated, false);
});

test('summarizes JSON record arrays and counts missing values', () => {
  const result = analyzeTabularData(JSON.stringify([{ a: 2, b: 'x' }, { a: 4, b: null }, { a: 8 }]));
  assert.equal(result.format, 'json');
  assert.equal(result.rows, 3);
  assert.ok(Math.abs(result.columns[0].mean - 14 / 3) < 1e-12);
  assert.equal(result.columns[1].missing, 2);
});

test('rejects malformed or unsupported data shapes and bounded input overflow', () => {
  assert.throws(() => analyzeTabularData(''), /Provide CSV or JSON/);
  assert.throws(() => analyzeTabularData('a,b\n1,"unfinished'), /unclosed quoted field/);
  assert.throws(() => analyzeTabularData('{"x":1}'), /array of objects/);
  assert.throws(() => analyzeTabularData('x'.repeat(500_001)), /character limit/);
});
