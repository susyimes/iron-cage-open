# Visual checks

## Presentation

- Cue camera: raised, centered behind the shot, with exponential smoothing. Near-side cage panels and bars fade so the camera can sit outside the physical cage. Ball collisions still use the unchanged cage bounds.
- Table camera: perspective fitting includes the table corners, fence height and HUD margins. Landscape views favor a diagonal view along the long side; portrait views keep the initial table upright. `V` and the HUD button toggle the survey view.
- Materials: emerald cloth with restrained normal detail; polished walnut with independent linear roughness and height maps; bronze cage hardware; nonmetallic clear-coated balls. Striped balls have a colored equatorial band and white caps. Procedural textures require no external image downloads.
- Room: a private billiard club with walnut and green wall panels, brass mouldings, stone flooring and an inset geometric carpet. A backlit three-bay bar, leather lounge seating, side lamps, cue display and suspended green-shade lamps furnish all four sides. The table has walnut aprons and brass feet/inlays.
- Cutaway: camera-side room sections fade as the camera approaches/passes the wall. The coffered ceiling and pendant share a separate height-based fade, keeping the overhead view clear. Light remains stable during a cutaway; decorative furniture adds no physics colliders or shadow-casting lights.
- Performance: static room geometry is merged by material within each independently fading wall section. The room uses the existing environment map and shadow light, without a reflection or postprocessing pass. Upholstery, stone, carpet and signage are generated locally once per game instance.
- Feedback: soft contact shadows expand and fade with ball height. Gold cage sparks, ball impacts, colored fragments and mint pocket ripples have separate lifetimes. At most 280 particles and 8 pooled ripples exist. Idle effects draw zero points; restarting a run clears effects.

## Automated checks

Run from the repository root after `npm install`:

```sh
npm run typecheck
npm run test:visual
npm run test:online
npm run build
```

`test:visual` projects the actual bounds through Three.js camera matrices for 576 combinations of aspect, elevation and azimuth. It also checks particle limits, expiry, pooled objects and hit-stop reset. These tests complement rendered inspection; they cannot determine visual quality by themselves.

## Rendered inspection

Use the actual WebGL renderer, including the production build (`npm run build` then `npm start`), at desktop 1600×900, portrait 390×844 and landscape 844×390.

1. Start a run. Check the cue, number patches, contact shadows and aim line; the cue should no longer fill the foreground.
2. Toggle `V` or **全桌**, then reset with `R`. In the overview, all six pockets must remain visible without a foreground post or overhead lamp blocking them.
3. Charge and release a shot. Follow the smooth transition to the fixed table view, then the return to the cue after settling. Check that sparks fade, chips fall and pocket rings expire.
4. Orbit, zoom and resize. Camera-side steel should fade smoothly, while far-side steel remains visible. Check that the wire pattern has recognizable openings instead of dense stippling.
5. On a touch viewport, use the view button, charge button and orientation change. Controls must remain reachable.
6. Join one room from two browser contexts. Both clients must play the server shot, reach identical ball positions and pass the turn. Repeat a fresh run to check that old particles and shadows do not accumulate.
7. Check the club at the three viewport sizes while aiming, surveying and changing shot direction. Room furniture, ceiling and pendant must not cover the six pockets. The brighter surroundings must not wash out HUD text.

`node scripts/room-browser-selftest.mjs` captures the club's aiming and overview views at 1600×900, 390×844 and 844×390. It uses the same `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `QA_OUTPUT_DIR` and `QA_URL` environment variables as the gameplay browser script (default URL: production server on port 43154). It checks actual room mesh intersections along 1,296 pocket sightlines over 216 camera poses, including cue positions near both ends of the table, and checks the scene's draw/geometry budget. The current captures have no room occlusion, at most 195 draw calls and 92,184 triangles, with one shadow-casting light. These are rendered scene budgets, not a physical-phone frame-rate measurement.

Browser viewport emulation does not replace testing on a physical phone. No new postprocessing render pass or external texture asset is required.
