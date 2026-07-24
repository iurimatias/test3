# Stick Empires

An Age of Empires–style real-time strategy game where every unit and building is
drawn as hand-sketched line art on paper. No build step, no dependencies — plain
HTML, CSS and JavaScript on a 2D canvas.

## Running it

```bash
python3 serve.py
```

Then open <http://localhost:8123>.

Opening `index.html` directly from disk works too, but a server is recommended —
some browsers restrict canvas and asset loading over `file://`.

## The game

Start with a Town Center and four villagers. Gather **food, wood, gold and
stone**, expand your economy, raise an army and destroy the red empire.

**Four ages.** Advance at the Town Center once you have enough resources and
enough buildings from your current age. Each age unlocks stronger buildings and
automatically upgrades your unit lines:

| Line | Dark | Feudal | Castle | Imperial |
|---|---|---|---|---|
| Infantry | Militia | Man-at-Arms | Long Swordsman | Champion |
| Spear | Spearman | Spearman | Pikeman | Pikeman |
| Archer | — | Archer | Crossbowman | Arbalester |
| Cavalry | — | Scout | Knight | Paladin |

Spearmen do bonus damage to cavalry. Archers deal pierce damage and are halved
against buildings. Blacksmith upgrades raise attack and armour army-wide.

**Economy.** A villager carries 12 resources, then walks them to the nearest
drop-off building. Put a Lumber Camp in the woods and a Mining Camp by the gold —
the walk is the real cost. When the berries run dry, build farms.

## Controls

| | |
|---|---|
| Scroll | Arrow keys, screen edges, middle-drag, or the minimap |
| Zoom | Mouse wheel |
| Select | Left-click · drag a box · double-click for all of that type on screen |
| Add to selection | Shift+click |
| Command | Right-click — move, gather, build, repair or attack, chosen by target |
| Attack-move | `A` then click |
| Stop | `S` |
| Build menu | `B` (with a villager selected) |
| Rally point | Right-click with a production building selected |
| Control groups | `Ctrl+1…9` to set, `1…9` to recall, double-tap to jump |
| Jump to Town Center | `H` |
| Cycle idle villagers | `.` |
| Select army | `F` |
| Jump to last attack | `Space` |
| Pause | `P` · 2× speed `F2` |

## Code layout

Scripts load in order from `index.html`; there are no modules or globals-by-import,
just an ordered set of plain scripts.

| File | Role |
|---|---|
| `js/config.js` | Tunable constants and the unit / building / research data tables |
| `js/utils.js` | Math, seeded RNG, cost helpers |
| `js/pathfinding.js` | Walkability grid, binary-heap A\*, throttled path queue |
| `js/worldgen.js` | Terrain, ponds, forests, mines, starting positions |
| `js/art.js` | Every drawing routine — sketch primitives, stick figures, buildings, terrain |
| `js/entities.js` | Resource nodes, units (state machine), buildings, projectiles |
| `js/render.js` | Camera, depth-sorted world draw, fog of war, minimap |
| `js/game.js` | Player state, world collections, simulation loop, spatial queries |
| `js/ai.js` | Opponent: economy balancing, build order, age timing, army waves |
| `js/input.js` | Mouse, keyboard, selection, command dispatch |
| `js/ui.js` | HUD, selection panel, command card, overlays |
| `js/main.js` | Canvas sizing, start screen, frame loop |

A few notes for anyone extending it:

- **Adding a unit or building** is usually just a new entry in `UNIT_DEFS` /
  `BUILDING_DEFS` plus a `case` in `art.js`. Unit lines are wired through
  `UNIT_LINES`, so a new tier slots into the age progression automatically.
- **Icons are generated from the game art** at runtime (`makeUnitIcon`), so a new
  unit gets a matching command-card button for free.
- **The AI is not special-cased.** It drives the same commands the player does, and
  takes its target as a constructor argument — `new AIPlayer(G.players[0], G, 1)`
  makes the human side play itself, which is how the balance was tested.
