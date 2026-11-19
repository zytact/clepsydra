import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { TFunction } from 'i18next';
import { loginSourceText } from '@/utils/loginSource';

const t = ((key: string) => key) as unknown as TFunction;

describe('login source text', () => {
  test('names the Antigravity CLI login and explains it only reads quota', () => {
    expect(loginSourceText({ loginSource: 'antigravity-cli' }, t)).toEqual({
      label: 'auth_files.login_source_antigravity_cli',
      hint: 'auth_files.quota_only_hint_antigravity_cli',
    });
  });

  test('ignores sources it does not know', () => {
    expect(loginSourceText({ loginSource: 'other-cli' }, t)).toBeNull();
    expect(loginSourceText({}, t)).toBeNull();
  });

  test('every locale translates the new keys', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as { auth_files: Record<string, string>; quota_pool: Record<string, string> };
      expect(messages.auth_files.login_source_antigravity_cli).toBeTruthy();
      expect(messages.auth_files.quota_only_hint_antigravity_cli).toBeTruthy();
      expect(messages.quota_pool.not_routed).toBeTruthy();
    }
  });
});
