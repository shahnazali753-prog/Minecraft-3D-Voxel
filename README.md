# BLOCKWORLD

A complete, playable 3D voxel sandbox game for the browser, inspired by Minecraft.
It's built with **Three.js** and plain **HTML, CSS and JavaScript**, with no build step,
and it's designed to play well on **iPhone** and other mobile browsers as well as desktop.

## Features

- **Infinite procedural world** (chunks stream in and out around you): grass, dirt, stone, sand,
  wood, leaves, gravel, snow, coal and gold ore, plus colourful building blocks
- **Terrain**: rolling hills, tall snowy mountains, beaches, deserts, oceans and lakes, winding
  cave tunnels and caverns, trees, tall grass and flowers
- **Graphics**: procedural pixel-art textures, smooth ambient occlusion, sky shading (caves and
  tree cover are darker), gradient sky, blocky sun and moon, stars, drifting clouds, animated
  translucent water, underwater fog, break particles and a held-block view
- **Day and night cycle** with sunrise and sunset colours (day length is adjustable)
- **First-person movement**: walking, sprinting, jumping, swimming, auto-jump, and in creative mode, flying
- **Break and place blocks**, with a 9-slot **hotbar**
- **Creative mode**: unlimited blocks, instant breaking, flying, and a full block picker
- **Survival mode**: blocks take time to mine and drop into your hotbar, and placing uses them up
- **Save and load**: multiple worlds in `localStorage`, auto-saved every 30 s and whenever the tab is hidden or closed
- **Menus**: title screen (with a live world behind it) and Play, Create World and Settings screens,
  plus pause and inventory screens
- **Settings**: render distance, sensitivity, FOV, day length, graphics quality, clouds,
  auto-jump, view bobbing, sound, FPS counter and invert look

## Running it

The game uses ES modules, so it has to be served over HTTP. Opening `index.html` directly
from disk (`file://`) won't work. Pick any static server:

```bash
# Node (no install needed)
npx http-server -c-1 -p 8080 .
#   or: npm start

# Python
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

### Playing on an iPhone or other phone

1. Start a server on your computer as shown above.
2. Make sure your phone is on the same Wi-Fi, then open `http://<your-computer-ip>:8080` in Safari.
   (On macOS, find the IP with `ipconfig getifaddr en0`. On Linux, use `hostname -I`.)
3. For a fullscreen experience, tap **Share → Add to Home Screen** and launch it from there.
   Landscape is recommended.

You can also host the folder on any static host, such as **GitHub Pages**
(Settings → Pages → deploy from branch, root folder). Three.js is vendored in `lib/`, so
nothing is loaded from a CDN. The only external request is the optional pixel font from
Google Fonts, and the game falls back to a monospace font without it.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | `W A S D` / arrow keys | Drag on the left side (virtual joystick, push far to sprint) |
| Look | Mouse (click the game to capture it) | Drag on the right side |
| Jump / swim up | `Space` | **Jump** button |
| Sprint | `Ctrl` or `R` | Push the joystick to its edge |
| Sneak / fly down | `Shift` | **Down** button (shown while flying) |
| Fly (creative) | Double-tap `Space` or `F` | **Fly** button |
| Break block | Hold left mouse button | Hold **Break** |
| Place block | Right mouse button | **Place** |
| Pick block (creative) | Middle mouse button | – |
| Select hotbar slot | `1`–`9` / mouse wheel / click | Tap a slot |
| Block picker (creative) | `E` | ▦ button next to the hotbar |
| Pause | `Esc` (or `P`) | ❚❚ button |

## Project structure

```
index.html            Page shell: canvas, HUD, touch controls and menus
css/style.css         All styling (HUD, touch UI, menus, responsive and safe areas)
lib/three.module.min.js  Three.js r170 (vendored, MIT licence)
js/
  main.js             Game class: renderer, state machine, game loop, interaction, saving
  world.js            Chunk streaming, block get/set, edit tracking, meshes, voxel raycast
  worldgen.js         Deterministic terrain: height, biomes, caves, ores, water, trees, flowers
  mesher.js           Chunk meshing: face culling, ambient occlusion, sky shading, plants, water
  blocks.js           Block registry, procedural texture atlas, hotbar icons
  sky.js              Sky dome shader, sun, moon, stars, clouds, day/night lighting and fog
  player.js           AABB physics: walk, jump, swim, fly, auto-jump, collisions
  controls.js         Keyboard, mouse and pointer lock, plus touch joystick, look drag and buttons
  ui.js               Menus, world list, settings form, hotbar and inventory
  storage.js          localStorage saves (worlds index, per-world data) and settings
  particles.js        Instanced block-break particles
  audio.js            Synthesized Web Audio sound effects
  noise.js            Seeded simplex noise and hashing
  three.js            Re-exports Three.js from lib/
tests/smoke.mjs       End-to-end test in headless Chromium (desktop and emulated iPhone)
```

### Saved data

Each world stores its seed and **only the blocks you changed**, so saves stay small. Keys:
`blockworld.worlds` (index), `blockworld.world.<id>` (world data) and `blockworld.settings`.

### Mobile performance

- Chunks are generated and meshed in a time-budgeted queue, nearest first, so frames never stall
- Hidden faces are culled, and each chunk has one opaque mesh and one water mesh
- Lighting is per-vertex Lambert, with no shadow maps or post-processing
- Pixel ratio is capped by the quality setting, and touch devices default to a render distance of 3

## Testing

```bash
npm i -D playwright   # or use a globally installed playwright
node tests/smoke.mjs
```

The smoke test serves the game, then in desktop Chromium and an emulated iPhone 13 it:

- opens the menus and creates a world
- checks the player spawns on the ground
- breaks and places blocks
- walks with the keyboard, and with the touch joystick
- tests touch look, the jump button and creative flight
- saves, reloads the page and restores the world
- fails if there are any JavaScript errors

Screenshots go to `tests/screenshots/`.
