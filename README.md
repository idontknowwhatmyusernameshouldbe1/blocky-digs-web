# Blocky Digs Web

Browser client for **Blocky Digs** that **cross-plays** with the PC MonoGame game over WebSockets.

## Cross-play (PC host + web join)

1. On PC, run Blocky Digs and press **2 Host LAN**.
2. Note the IP in the window title / HUD (also opens **web port 7778**).
3. Here:

```bash
cd blocky-digs-web
npm install
npm run dev
```

4. Open the URL Vite prints → it **auto-scans** the LAN, or click **Scan LAN for servers**.
5. Click a found host (or type an IP and Join).

Discovery uses HTTP port **7779** (PC advertises). Gameplay uses WebSocket **7778**.

## Controls

### Desktop
| Input | Action |
|-------|--------|
| Click | Capture mouse |
| Esc | Release mouse |
| WASD / Space / Shift | Move / jump / sprint |
| LMB | Punch player or dig |
| RMB | Place hotbar block |
| 1–4 | Hotbar |
| T | Chat |

### Touch (auto-detected)
| Input | Action |
|-------|--------|
| Left stick | Move |
| Drag on right side | Look |
| Dig / Place | Break or place |
| Jump / Sprint | Jump / sprint |
| Chat | Open chat |
| Tap hotbar slots | Select block |

## Notes

- Web cannot host LAN by itself (browsers can’t listen); the **PC hosts**.
- Allow firewall for ports **7777** and **7778** when playing on a network.
- Terrain generation matches the PC seed algorithm so everyone sees the same world.
