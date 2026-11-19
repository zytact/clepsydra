import type { LoginSourceText } from '@/utils/loginSource';
import styles from './LoginSourceTag.module.scss';

export function LoginSourceTag({ source }: { source: LoginSourceText }) {
  return (
    <span className={styles.tag} title={source.hint}>
      {source.label}
    </span>
  );
}
