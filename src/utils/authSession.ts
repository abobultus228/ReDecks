function decodeDeep(raw: string): string {
  let value = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

function cookieValues(raw: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = decodeDeep(part.slice(0, separator).trim());
    values.set(name, decodeDeep(part.slice(separator + 1).trim()));
  }
  return values;
}

function userIdFromValue(value: string): string {
  const decoded = decodeDeep(value);
  try {
    const user = JSON.parse(decoded);
    const id = user?.id ?? user?.user?.id;
    if (id != null && /^\d+$/.test(String(id))) return String(id);
  } catch {
    // Старые значения могли быть невалидным JSON.
  }
  return decoded.match(/"id"\s*:\s*(\d+)/)?.[1] ?? '';
}

/** Поддерживает старые cookie token/user и новые auth:token/auth:user. */
export function findAuthSession(cookie: string, storage: Record<string, string>): { token: string; userId: string } {
  const cookies = cookieValues(cookie);
  const token = ['auth:token', 'token']
    .map((key) => cookies.get(key) || storage[key] || '')
    .find(Boolean) ?? '';
  const userValue = ['auth:user', 'user']
    .map((key) => cookies.get(key) || storage[key] || '')
    .find(Boolean) ?? '';
  let userId = userIdFromValue(userValue);
  if (!userId) {
    for (const [key, value] of Object.entries(storage)) {
      if (/user/i.test(key)) {
        userId = userIdFromValue(value);
        if (userId) break;
      }
    }
  }
  return { token: token.replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim(), userId };
}
