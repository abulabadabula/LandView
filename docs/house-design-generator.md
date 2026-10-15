# LandView AI House Generator: design and validation contracts

## Status and boundary

The example file is a design-input example only. It does not represent a generated house, a verified architectural design, a building-consent design or a promise that the requested brief fits a selected property.

Keep four separate stages:

1. Validate user intent against HouseDesignSpec.
2. Let an AI model propose structured semantic choices, not arbitrary Three.js vertices.
3. Feed the choices into a deterministic parametric geometry builder to produce a candidate footprint, floor plates, roof and openings.
4. Run the candidate through the site/rule validator. A validator must not infer missing planning controls or quietly treat unknown values as passing.

The current implementation provides the input schema and validation contract, plus first-pass deterministic checks for a supplied candidate. It does not yet implement the AI provider, the parametric mesh builder, room layout generation or GLB export.

## Design-input example

The example is stored at docs/examples/house-design-input.example.json. The seven requested values are preserved. grossFloorAreaBasis is intentionally absent because it has not been confirmed whether the 200 m² target includes the double garage.

The formal input schema is docs/schemas/HouseDesignSpec.schema.json and is exposed from GET /api/house-design/spec/schema.

## JSON Schema rules

The schema uses JSON Schema Draft 2020-12. Unknown properties are rejected. Numeric bounds are input validation bounds, not New Zealand planning or Building Code limits. The user brief is:

    {
      "storeys": 2,
      "bedrooms": 4,
      "grossFloorAreaTargetM2": 200,
      "style": "Contemporary",
      "roof": "Gable roof",
      "garage": "Double garage",
      "terrainAdaptation": "Adapt to terrain"
    }

The API normalises the accepted input by adding schemaVersion 1.0.0. The optional grossFloorAreaBasis accepts includesGarage or excludesGarage and should be set only after the project defines the area-measurement convention.

## Parametric geometry contract

The parametric builder should be deterministic: the same normalised spec, geometry parameters, site geometry and terrain samples should produce the same candidate geometry. Random or unstructured model-generated vertex coordinates are not a safe geometry interface.

### Coordinate and placement rules

- Use NZTM2000 (EPSG:2193) metres for parcel, setback, footprint, terrain sample and site-rule calculations.
- Use a local building coordinate frame for the Three.js builder, with a recorded origin and rotation that map its local axes to the NZTM site frame.
- Convert to WGS84/ECEF only when placing the final review asset in CesiumJS. Avoid using longitude/latitude as the working coordinate system for room dimensions or polygon-area calculations.
- Every candidate floor plate uses a 2D exterior ring in NZTM coordinates. Level 0 is the ground storey. Floors remain planar and level; do not warp floor plates to match a terrain mesh.

### Area allocation

- Treat grossFloorAreaTargetM2 as a target, not a claim about an already-built or already-generated model.
- The arithmetic 200 m² / 2 storeys = 100 m² per storey is only an initial even-allocation heuristic. The builder may redistribute area in response to the garage, room program, parcel envelope and site slope.
- Sum floor-level GFA using one consistently declared basis. Do not silently change whether garage area is included between the design target, floor-area schedule and planning rule input.
- If the GFA basis is unresolved, return the target check as NOT_EVALUATED; do not tell the user that the 200 m² target has been met.

### Initial massing and room-program rules

- Derive the feasible building envelope from the actual parcel and rule-specific buildable/setback geometry before choosing a footprint. The existing generic 1 m inward parcel buffer is a geometric helper only; it must not automatically be treated as a legally required setback.
- Fit a double-garage bay as a parameterised module with two bays, structural/wall clearances, vehicle-door openings and a connection to the entry/mudroom. Bay width and depth are configurable design parameters, not hard-coded planning limits.
- Create the requested four bedroom records in a room-program graph. Place shared living/kitchen zones, wet areas, stairs and circulation around the graph; reject overlapping room solids and inaccessible/disconnected rooms. Room dimensions, window areas, stair geometry and egress rules must be explicit parameters and need their own rule checks.
- For a gable roof, derive the ridge axis from the selected primary massing block, set pitch/eaves/ridge offset as parameters, then build roof planes and gable ends from the footprint and roof parameters. Include roof height in height and envelope checks.
- For Contemporary style, choose a configurable facade/material palette and controlled massing variations. Style is a visual preference, not a substitute for geometry or planning constraints.

### Terrain adaptation

- Sample terrain beneath and around the proposed ground footprint. Record the terrain source, capture/resolution metadata where available, and vertical datum.
- Keep finished floor levels explicit for each ground-level plate. Compare them to terrain samples using a project-defined cut/fill screening tolerance, then report sampled deviations.
- Do not turn a coarse global DEM into a claim of lot-scale ground truth. Missing, coarse or datum-unknown terrain should produce NOT_EVALUATED.
- A sampled cut/fill screen is not a retaining-wall, foundation, geotechnical, stormwater or earthworks design. Escalate those checks when the design requires them.

## Hard-constraint validation interface

### Request and response

POST /api/house-design/constraints/validate accepts three separate objects: spec, candidate and siteConstraints. The candidate is supplied to the validator; this endpoint never creates candidate geometry.

Candidate floor-footprint rings and terrain samples use [easting, northing] pairs in EPSG:2193 metres. Floor level 0 means ground floor. If grossFloorAreaBasis is provided, it must be consistent for candidate totals, floor-level areas and site GFA rules.

The result lists every check with a code, severity, status, message, actual value, limit and source reference where available.

- PASS: the check was evaluated and the supplied values satisfy it.
- FAIL: an evaluated hard constraint was breached.
- NOT_EVALUATED: required geometry, terrain, rule limit, provenance or accounting basis is missing or unverified.
- NOT_APPLICABLE: the confirmed rule input explicitly marked that rule as not applicable.

Overall status is FAIL if any HARD check fails; otherwise BLOCKED if any HARD check remains NOT_EVALUATED; otherwise PASS. Design-target checks (for example the 200 m² GFA target) are reported separately and do not override a hard-constraint failure or make missing rules pass.

To avoid accidental false approvals, planning-specific checks are treated as unverified until planningRulesConfirmed is true, the rule source name/version/URL are provided, and unverifiedRulesRemain is false. Any omitted or unimplemented applicable control must keep the result blocked. The caller should set these fields only after source-backed rule retrieval and review; a client-provided boolean is not proof that a rule set is correct.

### Checks in this first interface

- Input consistency: requested/candidate storeys and bedrooms; continuity of floor-plate levels.
- Geometry: valid polygons, every floor plate covered by parcel, and—when supplied and source-confirmed—every floor plate covered by the buildable/setback polygon.
- Rule values: maximum storeys, maximum building height, maximum site coverage and optional GFA range, all linked to the supplied rule source.
- Design goal: GFA target tolerance is a configurable review tolerance (default 5%, not a statutory limit); it is not assessed when the garage/GFA basis is unresolved.
- Terrain: if terrain adaptation is requested, use terrain samples in the same vertical datum and a project-defined maximum cut/fill screening tolerance. This is only a preliminary sampled check.

This is not yet a complete Auckland Unitary Plan or New Zealand Building Code rules engine. Height-in-relation-to-boundary/recession planes, overlays, hazards, access, daylight, parking, infrastructure, stormwater, fire, structure, accessibility, foundations and consent requirements must be added from verified sources and domain-specific checkers before a real design could be relied upon. Never infer those controls from the 1 m display setback alone.

## Endpoints

- GET /api/house-design/spec/schema: machine-readable input JSON Schema.
- POST /api/house-design/spec/validate: validate and normalise user input; modelGenerated remains false.
- POST /api/house-design/constraints/validate: validate a supplied candidate against supplied parcel, terrain and rule constraints; it does not generate geometry.

The eventual geometry pipeline is intended to create a Three.js parametric candidate and export a GLB review asset for CesiumJS. That pipeline and an AI-generated real or buildable house are not implemented by these contracts.

