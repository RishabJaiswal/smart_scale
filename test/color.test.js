import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, readableTextOn, isLightColor } from '../src/ui/color.js';

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

describe('isLightColor', () => {
  test('light accents cannot carry lines or text on a light surface', () => {
    assert.equal(isLightColor('#dff25e'), true);
    assert.equal(isLightColor('#fde047'), true);
  });

  test('dark and mid accents can', () => {
    assert.equal(isLightColor('#0f766e'), false);
    assert.equal(isLightColor('#2563eb'), false);
  });
});
