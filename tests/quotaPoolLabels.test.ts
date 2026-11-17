import { describe, expect, test } from 'bun:test';
import { accountLabels } from '@/features/quota/pool/labels';

const labelsOf = (emails: string[]) => {
  const labels = accountLabels(emails);
  return emails.map((email) => labels.get(email));
};

describe('accountLabels', () => {
  test('uses the first two letters before the @, ignoring separators', () => {
    expect(labelsOf(['that.alex@gmail.com', 'kimi@example.com'])).toEqual(['TH', 'KI']);
  });

  test('adds the first differing character on a collision', () => {
    expect(labelsOf(['that.zed@gmail.com', 'that.alex@gmail.com'])).toEqual(['TZ', 'TA']);
  });

  test('uses the domain when the names are identical', () => {
    expect(labelsOf(['alex@gmail.com', 'alex@outlook.com'])).toEqual(['AG', 'AO']);
  });

  test('reaches digits only when they are where the names differ', () => {
    expect(labelsOf(['alex724@gmail.com', 'alex725@gmail.com'])).toEqual(['A4', 'A5']);
  });

  test('grows to three characters when two characters still collide', () => {
    expect(labelsOf(['thatab@x.com', 'thatac@x.com', 'thatzz@x.com'])).toEqual([
      'TAB',
      'TAC',
      'TZ',
    ]);
  });

  test('one address shares a label across providers, whatever its case', () => {
    const labels = labelsOf(['ab@x.com', 'AB@x.com', 'ab@y.com']);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[2]).not.toBe(labels[0]);
  });

  test('a label made from a collision never repeats a default label', () => {
    const labels = labelsOf(['tb@x.com', 'tazb@x.com', 'tazc@x.com']);
    expect(new Set(labels).size).toBe(3);
    expect(labels.every((label) => label !== undefined && /^[A-Z0-9]{2,3}$/.test(label))).toBe(
      true
    );
  });

  test('labels names without an @', () => {
    expect(labelsOf(['claude-main.json'])).toEqual(['CL']);
  });
});
