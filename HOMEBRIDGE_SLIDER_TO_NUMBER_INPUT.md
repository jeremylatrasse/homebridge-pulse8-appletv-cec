# Replacing Sliders with Number Entry Fields in Homebridge `config.schema.json`

Homebridge Config UI X renders plugin settings using `@ng-formworks/core`, which automatically turns bounded numeric fields in `config.schema.json` into range sliders (`<input type="range">`) instead of number entry boxes (`<input type="number">`).

This guide explains **why** that happens, **how to find every slider** in any Homebridge plugin project, and the **cleanest fix** to turn them into number entry fields without losing schema validation.

---

## 1. Why Homebridge UI Renders Sliders

In `@ng-formworks/core` (`getInputType()`), a numeric property becomes a slider (`"range"`) whenever **all** of the following are true and no explicit widget override is set:

1. `"type"` is `"integer"` **or** the property defines `"multipleOf"`
2. `"minimum"` is defined
3. `"maximum"` is defined

| Schema Shape | Default Rendered Control |
| --- | --- |
| `"type": "integer"` + `"minimum"` + `"maximum"` | Slider (`<input type="range">`) |
| `"type": "number"` + `"multipleOf"` + `"minimum"` + `"maximum"` | Slider (`<input type="range">`) |
| `"type": "number"` (no `"multipleOf"`) + `"minimum"` + `"maximum"` | Entry field (`<input type="number" step="any">`) |
| Missing either `"minimum"` or `"maximum"` | Entry field (`<input type="number">`) |

---

## 2. Recommended Fix: Add `"x-schema-form": { "type": "number" }`

Add `"x-schema-form": { "type": "number" }` directly to each affected field inside `config.schema.json`.

### Before (renders a slider)

```json
"trinnovPort": {
  "title": "Trinnov TCP Port",
  "type": "integer",
  "default": 44100,
  "minimum": 1,
  "maximum": 65535,
  "description": "Trinnov automation protocol TCP port (default: 44100)."
}
```

### After (renders a number entry field)

```json
"trinnovPort": {
  "title": "Trinnov TCP Port",
  "type": "integer",
  "default": 44100,
  "minimum": 1,
  "maximum": 65535,
  "x-schema-form": {
    "type": "number"
  },
  "description": "Trinnov automation protocol TCP port (default: 44100)."
}
```

### Why this is the safest approach

- **Keeps full validation:** `"type": "integer"`, `"minimum"`, `"maximum"`, and `"multipleOf"` continue to be enforced by both AJV and HTML attributes (`min`, `max`, `step`).
- **Keeps integer stepping:** For `"type": "integer"`, `@ng-formworks/core` still sets `step="1"` and disallows decimals automatically.
- **Works everywhere in the schema:** Applies identically to top-level `schema.properties`, nested `object` properties, `array.items.properties` (such as `devices[].port`), and `oneOf`/`anyOf`/`allOf` branches.
- **No layout maintenance:** Unlike a top-level `"layout"` array, you do not have to manually list fields, manage `"*"` wildcards, or worry about hiding new fields or `_bridge`.

> **Note:** `"widget": "number"` also works in `getInputType()`, but `"x-schema-form": { "type": "number" }` is preferred because `@ng-formworks/core` explicitly strips `x-schema-form` from widget `options` instead of passing it down as an extra option property.

---

## 3. Finding All Sliders in Any Plugin Project

Run this one-liner from the root of any Homebridge plugin repo to list every field in `config.schema.json` that will render as a slider:

```bash
node -e '
const fs = require("fs");
const root = JSON.parse(fs.readFileSync("config.schema.json", "utf8"));
const hits = [];
function walk(node, path) {
  if (!node || typeof node !== "object") return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const isBounded = Object.hasOwn(node, "minimum") && Object.hasOwn(node, "maximum");
  const isSliderType = types.includes("integer") || (types.includes("number") && Object.hasOwn(node, "multipleOf"));
  const hasOverride = Boolean(
    node["x-schema-form"]?.type ||
    node["x-schema-form"]?.widget?.component ||
    (typeof node["x-schema-form"]?.widget === "string") ||
    node.widget?.component ||
    (typeof node.widget === "string")
  );
  if (isBounded && isSliderType && !hasOverride && path !== "schema.properties._bridge.properties.port") {
    hits.push({ path, type: node.type, minimum: node.minimum, maximum: node.maximum, multipleOf: node.multipleOf });
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.properties.${k}`);
  }
  if (node.items) {
    if (Array.isArray(node.items)) node.items.forEach((v, i) => walk(v, `${path}.items[${i}]`));
    else walk(node.items, `${path}.items`);
  }
  if (node.additionalItems && typeof node.additionalItems === "object") {
    walk(node.additionalItems, `${path}.additionalItems`);
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((v, i) => walk(v, `${path}.${key}[${i}]`));
  }
  for (const key of ["if", "then", "else"]) {
    if (node[key] && typeof node[key] === "object") walk(node[key], `${path}.${key}`);
  }
}
walk(root.schema, "schema");
console.table(hits);
'
```

If `hits` is empty after your edits, every bounded numeric slider in `config.schema.json` has been converted to an entry field.

### Checklist of Places to Inspect Manually

- Top-level `schema.properties.*`
- Nested object `properties.*`
- Array item schemas (`schema.properties.<array>.items.properties.*`)
- Conditional schemas (`oneOf`, `anyOf`, `allOf`, `if` / `then` / `else`)
- Any existing `"layout"` or `"form"` section in `config.schema.json` (if present, verify no entry forces `"type": "range"` or `"widget": "range"`)

---

## 4. Alternative Approaches & Trade-Offs

| Approach | Pros | Cons / Gotchas |
| --- | --- | --- |
| `"x-schema-form": { "type": "number" }` on each property **(Recommended)** | Keeps `"integer"` / `min` / `max` validation; works in nested arrays; no field-order side effects | Non-standard JSON Schema extension key (ignored by AJV in Homebridge UI) |
| Top-level `"layout"` / `"form"` array with `{ "key": "...", "type": "number" }` | Standard schema-form layout syntax | Omitting `"*"` hides unlisted fields; requires updating array syntax (`devices[].field`) and maintaining field order |
| Change `"type": "integer"` to `"type": "number"` (and remove `"multipleOf"`) | Uses only standard JSON Schema keywords | Allows decimal values (e.g., `44100.5` for a TCP port) |
| Remove `"minimum"` or `"maximum"` | Uses only standard JSON Schema keywords | Loses UI and schema bounds validation |

---

## 5. Verification

After updating `config.schema.json`:

1. **Validate JSON syntax:**
   ```bash
   node -e 'JSON.parse(require("fs").readFileSync("config.schema.json", "utf8")); console.log("Valid JSON");'
   ```
2. **Re-run the slider audit script** in Section 3 and confirm it prints an empty table.
3. **Run the plugin test suite** (e.g., `npm test`).
4. **Verify in Homebridge UI:** Open the plugin's settings modal in Homebridge Config UI X and confirm all numeric fields—including items inside repeatable array sections—display text/number entry boxes instead of range sliders.
