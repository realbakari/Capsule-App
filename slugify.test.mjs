import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slugify.mjs';

test('lowercases input', () => {
  assert.equal(slugify('HELLO'), 'hello');
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('converts spaces to hyphens', () => {
  assert.equal(slugify('hello world'), 'hello-world');
  assert.equal(slugify('hello   world'), 'hello-world');
  assert.equal(slugify('  hello world  '), 'hello-world');
});

test('strips punctuation', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify("it's a test."), 'its-a-test');
  assert.equal(slugify('foo_bar@baz.com'), 'foobarbazcom');
});

test('returns empty string for empty input', () => {
  assert.equal(slugify(''), '');
});

test('handles non-string input', () => {
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
});

test('collapses existing hyphens and trims edge hyphens', () => {
  assert.equal(slugify('-hello-world-'), 'hello-world');
  assert.equal(slugify('hello--world'), 'hello-world');
});
