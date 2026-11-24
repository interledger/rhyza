import { SERVICE_START_ORDER } from './service-names';

export function selectServices(raw: string | undefined): string[] {
  const requested = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (requested.length === 0) return [...SERVICE_START_ORDER];
  for (const name of requested) {
    if (!SERVICE_START_ORDER.includes(name)) {
      throw new Error(`unknown service in RHYZA_SERVICES: "${name}"`);
    }
  }
  const wanted = new Set(requested);
  return SERVICE_START_ORDER.filter((name) => wanted.has(name));
}
