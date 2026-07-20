export type DiscoveredServer = {
  ip: string;
  name: string;
  seed: number;
  ws: number;
  tcp: number;
  players: number;
};

/** Guess this machine's LAN IPv4 addresses via WebRTC ICE (no camera needed). */
export async function getLocalIpv4s(): Promise<string[]> {
  const found = new Set<string>();
  found.add('127.0.0.1');

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('bd');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = window.setTimeout(done, 1500);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          window.clearTimeout(timer);
          done();
          return;
        }
        const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(ev.candidate.candidate);
        if (m && !m[1].startsWith('0.')) found.add(m[1]);
      };
    });
    pc.close();
  } catch {
    // WebRTC blocked — still scan localhost
  }

  return [...found];
}

function subnetHosts(ip: string): string[] {
  if (ip === '127.0.0.1') return ['127.0.0.1'];
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return [];
  // Typical home LAN /24
  const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) hosts.push(`${base}.${i}`);
  return hosts;
}

async function probe(ip: string, port: number, timeoutMs: number): Promise<DiscoveredServer | null> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${port}/`, {
      signal: ctrl.signal,
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DiscoveredServer> & { game?: string };
    if (data.game !== 'BlockyDigs') return null;
    return {
      ip,
      name: data.name ?? 'Blocky Digs',
      seed: Number(data.seed ?? 0),
      ws: Number(data.ws ?? 7778),
      tcp: Number(data.tcp ?? 7777),
      players: Number(data.players ?? 1),
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** Scan LAN for PC hosts advertising on the discovery HTTP port. */
export async function scanLanServers(
  discoveryPort = 7779,
  onProgress?: (checked: number, total: number) => void,
): Promise<DiscoveredServer[]> {
  const locals = await getLocalIpv4s();
  const hostSet = new Set<string>();
  hostSet.add('127.0.0.1');
  for (const ip of locals) {
    for (const h of subnetHosts(ip)) hostSet.add(h);
  }
  const hosts = [...hostSet];
  let checked = 0;
  const results = await mapPool(hosts, 40, async (ip) => {
    const hit = await probe(ip, discoveryPort, 350);
    checked++;
    onProgress?.(checked, hosts.length);
    return hit;
  });

  const servers = results.filter((s): s is DiscoveredServer => s != null);
  // Dedupe by ip
  const byIp = new Map<string, DiscoveredServer>();
  for (const s of servers) byIp.set(s.ip, s);
  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}
