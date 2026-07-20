import { Game } from './game';
import { scanLanServers, type DiscoveredServer } from './discover';

const menu = document.getElementById('menu')!;
const status = document.getElementById('status')!;
const hostIp = document.getElementById('hostIp') as HTMLInputElement;
const btnJoin = document.getElementById('btnJoin')!;
const btnScan = document.getElementById('btnScan') as HTMLButtonElement;
const serverList = document.getElementById('serverList')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;

const game = new Game(canvas, {
  hud: document.getElementById('hud')!,
  menu,
  status,
  hp: document.getElementById('hp')!,
  hotbar: document.getElementById('hotbar')!,
  chatLog: document.getElementById('chatLog')!,
  chatBox: document.getElementById('chatBox')!,
  chatInput: document.getElementById('chatInput') as HTMLInputElement,
  topHint: document.getElementById('topHint')!,
  touchControls: document.getElementById('touchControls')!,
  stickBase: document.getElementById('stickBase')!,
  stickKnob: document.getElementById('stickKnob')!,
  lookZone: document.getElementById('lookZone')!,
});

function joinIp(ip: string): void {
  hostIp.value = ip;
  game.join(ip);
}

btnJoin.addEventListener('click', () => {
  joinIp(hostIp.value.trim() || '127.0.0.1');
});

hostIp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

function renderServers(servers: DiscoveredServer[]): void {
  serverList.innerHTML = '';
  if (servers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No hosts found. Is a PC on Host LAN + WEB?';
    serverList.appendChild(empty);
    return;
  }

  for (const s of servers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'server';
    btn.innerHTML = `<span>${s.name}<small>${s.ip} · seed ${s.seed} · ${s.players} in world</small></span><span>Join</span>`;
    btn.addEventListener('click', () => joinIp(s.ip));
    serverList.appendChild(btn);
  }
}

async function runScan(): Promise<void> {
  btnScan.disabled = true;
  btnScan.textContent = 'Scanning…';
  status.textContent = 'Looking for Blocky Digs hosts on your LAN…';
  serverList.innerHTML = '';

  try {
    const servers = await scanLanServers(7779, (checked, total) => {
      status.textContent = `Scanning LAN… ${checked}/${total}`;
    });
    renderServers(servers);
    status.textContent =
      servers.length === 0
        ? 'No servers found. Host with 2 on PC, allow firewall for 7779, then scan again.'
        : `Found ${servers.length} server${servers.length === 1 ? '' : 's'}.`;
  } catch (err) {
    status.textContent = 'Scan failed: ' + (err instanceof Error ? err.message : String(err));
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = 'Scan LAN for servers';
  }
}

btnScan.addEventListener('click', () => {
  void runScan();
});

// Auto-scan when the menu opens
void runScan();
