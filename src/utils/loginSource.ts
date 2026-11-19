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
  file: Pick<AuthFileItem, 'loginSource'>,
  t: TFunction
): LoginSourceText | null {
  const keys = file.loginSource ? LOGIN_SOURCE_KEYS[file.loginSource] : undefined;
  return keys ? { label: t(keys.label), hint: t(keys.hint) } : null;
}
