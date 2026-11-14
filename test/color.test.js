import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, readableTextOn } from '../src/ui/color.js';

describe('contrastRatio', () => {
  test('black on white is 21:1', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  });

  test('is symmetric', () => {
    assert.equal(contrastRatio('#0f766e', '#ffffff'), contrastRatio('#ffffff', '#0f766e'));
  });
});

describe('readableTextOn', () => {
  test('white on dark accents', () => {
    assert.equal(readableTextOn('#0f766e'), '#ffffff');
    assert.equal(readableTextOn('#4f46e5'), '#ffffff');
  });

  test('dark text on light accents', () => {
    assert.equal(readableTextOn('#fde047'), '#111418');
    assert.equal(readableTextOn('#7dd3fc'), '#111418');
  });
});
