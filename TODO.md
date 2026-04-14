# World — Todo List

## Backlog

### Simulation depth
- [x] Starvation death — agents die when hunger stays at 0 for N game-seconds; drop inventory, count in game over
- [x] Cooking as conversion — agent with fire + cooking converts raw fish/meat in inventory to cooked (consume wood as fuel)
- [ ] Disease — infection spreading between nearby agents; medicine/herbs reduce risk or duration; sick agents drain faster or gather less
- [x] Old-age weakening — slower movement and/or lower gather yield as age approaches life expectancy

### World & environment
- [x] Save/load — persist world seed, tiles, tileItems, agents, conceptGraph, time, weather, buildings
- [x] World seed input — show current seed in UI; "new world with this seed" and "enter seed" for replay/sharing
- [ ] Rivers — new tile type or overlay; crossable only with Rope (or raft concept)
- [x] Resource depletion feedback — overgrazed grass/forest tiles slowly degrade (e.g. cap or "degraded" state)
- [ ] Caves — new tile type or feature on mountain/stone; shelter from weather, maybe +discovery chance for fire or art
- [ ] Lightning strikes a tree → turns it into a dead tree (requires tile state + renderer rebuild)

### Animals & hunting
- [ ] Huntable wildlife — hunting concept actually removes/kills animal instances for meat (and hide); respawn or population later
- [ ] Predators — wolves/bears that can reduce agent health when adjacent; low-health or young agents at higher risk
- [ ] Animal populations — reproduction, migration, or extinction logic per species (or per spawn bucket)
- [ ] Domestication feedback — tamed animals near buildings periodically provide food or resources to gather

### Society & concepts
- [ ] Era 3+ — philosophy, governance, trade concepts (prereqs from writing/community)
- [ ] Trade — agents with "trade" concept exchange items when close (e.g. food for wood, ore for fish)
- [ ] Visible buildings from concepts — workshop (stone_tools + weaving), shrine (art + community), etc., when agent rests
- [ ] Conflict/rivalry — optional factions; different groups refuse to share knowledge or "dispute" (energy cost)
- [ ] Religion/culture — belief concepts that spread in subgroups and subtly alter behaviour (e.g. rest near buildings)

### UX & polish
- [x] Mini-map — 2D overview of terrain (colour by type), agent dots, maybe fires
- [x] Timeline/history — scrollable log of discoveries, births, weather events, population milestones
- [x] Achievements — e.g. "Survive 100 days", "Discover all Era 1 concepts", "Population 50"; store in localStorage
- [x] Fire gives light and heat at night — scale ambient/point lights by fire proximity and time-of-day; stronger cold at night
- [x] More discovery condition types — e.g. has_item, season, near_fire (in concepts.json + ConceptGraph)

### Technical & content
- [ ] Web Workers — run simulation tick in worker; main thread only render + input (scale to larger populations)
- [ ] Progressive Web App — service worker + manifest; installable, offline-capable
- [x] Tool items — add items in items.json with category "tool" and effects.activities / gatherMult (GatheringSystem already supports)
- [x] Crafting — recipes (e.g. wood + stone → stone_tool; ore + fire → metal_tool); gate on concepts, consume from inventory

### Cross-cutting / deeper
- [x] Carrying capacity from water — factor in fishing (water tiles) so coasts/islands can support population
- [ ] Seasonal migration — agents (or animals) bias movement toward better tiles in winter
- [ ] Natural disasters — drought, flood, blight (temporary tile or resource effects; seed + day for reproducibility)
- [x] First discoverer / lineage — track which agent first discovered each concept; show in timeline or on concept
- [x] Death log — on agent death, record "El died of old age (Day 67)" or "starvation" for timeline/post-mortem

## Done
- [x] Whale — fixed aspect ratio (now properly long, not wide), parts all scale dynamically with body size
- [x] Trees — 7 varieties with biome-noise clustering (pine, spruce, oak, birch, cherry, maple, dead); same type groups together in regions; dead trees scattered randomly ~10% (elongated sphere), belly patch, dorsal fin, pectoral fins, horizontal tail flukes with gentle bob, periodic blowhole spray fountain
- [x] Sailing boats — deeper hull with deck + side rails, taller mast, yardarm, bigger sail, flag at mast-top


- [x] Make trees more varied — pine (40%), oak (28%), cherry blossom (15%), dead (17%)
- [x] Drag and drop agents — click near agent and drag to new tile, snaps on release
- [x] Fix animals (sheep, pigs, etc.) walking on water — blocked on invalid tile during movement
- [x] Make cacti more varied — saguaro trunk + optional left/right arms (~60% of cacti)
- [x] Make crabs look more crab-like — wide flat body, sideways claws, eyes
- [x] Speech bubbles gated on language knowledge — agents only show bubbles after discovering language
- [x] Inventory system — fully working (agents gather, eat, drop on death; shown in info panel)
- [x] Deserts and beaches — confirmed generating OK
