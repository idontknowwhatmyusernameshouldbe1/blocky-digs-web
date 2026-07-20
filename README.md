# Blocky Digs Web

Browser client for **Blocky Digs** that **cross-plays** with the PC MonoGame game over WebSockets.

## Play online (GitHub Pages)

**https://idontknowwhatmyusernameshouldbe1.github.io/blocky-digs-web/**

### One-time setup (if the site 404s)

1. Wait for the green **Deploy GitHub Pages** check on `main`.
2. Repo **Settings → Pages**
3. **Source:** Deploy from a branch
4. **Branch:** `gh-pages` / `/ (root)` → Save

Then open the URL above.

## Run locally

```bash
cd blocky-digs-web
npm install
npm run dev
```

## Cross-play (PC host + web join)

1. On PC, run Blocky Digs and press **2 Host LAN + WEB**.
2. Open the Pages URL (or local `npm run dev`).
3. **Scan LAN** or type the PC IP and Join.

Discovery uses HTTP **7779**. Gameplay uses WebSocket **7778**. PC peers use TCP **7777**.

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
- Allow firewall for **7777**, **7778**, and **7779** on a network.
- Terrain generation matches the PC seed algorithm so everyone sees the same world.
