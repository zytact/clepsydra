const normalize = (email: string) => email.trim().toLowerCase();

const compact = (email: string) => {
  const at = email.lastIndexOf('@');
  const local = (at === -1 ? email : email.slice(0, at)).replace(/[^a-z0-9]/g, '');
  const domain = at === -1 ? '' : email.slice(at + 1).replace(/[^a-z0-9]/g, '');
  return domain ? `${local}@${domain}` : local;
};

const charAt = (value: string, index: number) => {
  const char = value[index] ?? '';
  return char === '@' ? (value[index + 1] ?? '') : char;
};

const defaultLabel = (value: string) => (value.replace('@', '').slice(0, 2) || '?').toUpperCase();

function settle(
  group: { email: string; key: string }[],
  prefix: string,
  from: number,
  labels: Map<string, string>
) {
  if (group.length === 1) {
    labels.set(group[0].email, prefix.toUpperCase());
    return;
  }
  const longest = Math.max(...group.map(({ key }) => key.length));
  let index = from;
  while (index < longest && group.every(({ key }) => key[index] === group[0].key[index])) {
    index += 1;
  }
  if (index >= longest || prefix.length >= 3) {
    group.forEach(({ email }) => labels.set(email, prefix.slice(0, 2).toUpperCase()));
    return;
  }
  const buckets = new Map<string, { email: string; key: string }[]>();
  for (const member of group) {
    const char = charAt(member.key, index);
    buckets.set(char, [...(buckets.get(char) ?? []), member]);
  }
  const skip = group.some(({ key }) => key[index] === '@') ? 2 : 1;
  for (const [char, members] of buckets) settle(members, `${prefix}${char}`, index + skip, labels);
}

function withDigits(labels: Map<string, string>) {
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const label of labels.values()) if (counts.get(label) === 1) taken.add(label);
  for (const [email, label] of labels) {
    if (counts.get(label) === 1) continue;
    const stem = label.slice(0, 2);
    let digit = 1;
    while (taken.has(`${stem}${digit}`)) digit += 1;
    const unique = `${stem}${digit}`;
    taken.add(unique);
    labels.set(email, unique);
  }
}

export function accountLabels(emails: readonly string[]): Map<string, string> {
  const unique = [...new Set(emails.map(normalize))];
  const byDefault = new Map<string, { email: string; key: string }[]>();
  for (const email of unique) {
    const key = compact(email);
    const label = defaultLabel(key);
    byDefault.set(label, [...(byDefault.get(label) ?? []), { email, key }]);
  }
  const labels = new Map<string, string>();
  for (const [label, group] of byDefault) {
    if (group.length === 1) labels.set(group[0].email, label);
    else settle(group, group[0].key[0] ?? '?', 1, labels);
  }
  withDigits(labels);
  return new Map(emails.map((email) => [email, labels.get(normalize(email)) ?? '?']));
}
