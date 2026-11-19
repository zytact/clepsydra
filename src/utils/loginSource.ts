import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';

const LOGIN_SOURCE_KEYS: Readonly<Record<string, { label: string; hint: string }>> = {
  'antigravity-cli': {
    label: 'auth_files.login_source_antigravity_cli',
    hint: 'auth_files.quota_only_hint_antigravity_cli',
  },
};

export interface LoginSourceText {
  label: string;
  hint: string;
}

export function loginSourceText(
  file: Pick<AuthFileItem, 'loginSource' | 'quotaOnly'>,
  t: TFunction
): LoginSourceText | null {
  const source = file.loginSource;
  if (!source) return null;
  const keys = LOGIN_SOURCE_KEYS[source];
  return {
    label: keys ? t(keys.label) : source,
    hint: keys ? t(keys.hint) : file.quotaOnly ? t('auth_files.quota_only_hint') : source,
  };
}
