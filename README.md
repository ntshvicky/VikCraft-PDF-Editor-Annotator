# VikCraftPDFEditor

A lightweight, framework‑agnostic PDF viewer + annotation library built with **PDF.js**, **Fabric.js**, and **jsPDF**.

- Pan/zoom, page navigation, light/dark theme
- Rect/Ellipse/Freehand/Highlighter tools
- Comment modal + right‑panel comment list
- Selection, edit/delete context menu with permissions
- Export **flattened annotated PDF**
- Optional REST API integration for server‑side storage

---

## Table of contents
- [Quick start](#quick-start)
- [Minimal example](#minimal-example)
- [Options](#options)
- [Toolbar](#toolbar)
- [Events](#events)
- [REST API contract (optional)](#rest-api-contract-optional)
- [Annotation schema](#annotation-schema)
- [Public methods](#public-methods)
- [Styling & theming](#styling--theming)
- [Export quality & offsets](#export-quality--offsets)
- [Integration notes (Django/React/etc.)](#integration-notes-djangoreactetc)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

---

## Quick start

1) **Files you need**
- `VikCraftPDFEditor.js` (the library)
- `style.css` (UI/theme)
- A PDF to load (e.g., `sample.pdf`)

2) **CDNs used**
- Fabric.js `5.3.1`
- PDF.js (ESM) + worker
- jsPDF `2.5.1`

> For production, **self‑host** PDF.js files (see Troubleshooting).

---

## Minimal example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VikCraftPDFEditor – Demo</title>
  <link rel="stylesheet" href="style.css" />
  <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
</head>
<body>
  <div id="pdf-editor-container"></div>

  <!-- Dependencies -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
  <script src="https://mozilla.github.io/pdf.js/build/pdf.mjs" type="module"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>

  <!-- Library -->
  <script type="module" src="VikCraftPDFEditor.js"></script>

  <!-- Init -->
  <script type="module">
    import VikCraftPDFEditor from './VikCraftPDFEditor.js';

    const editor = new VikCraftPDFEditor('pdf-editor-container', {
      pdfPath: './sample.pdf',
      currentUser: 'vik',
      permissions: { allowEdit: true, allowDelete: true },
      ui: { enableCommentsPanel: true },
      toolbar: {
        theme: 'light',
        actions: ['themeToggle'],
        navigation: ['prev', 'pageInput', 'next'],
        zoom: ['zoomOut', 'zoomIn', 'fitWidth'],
        drawing: [
          { tool: 'select',     promptForComment: false },
          { tool: 'pan',        promptForComment: false },
          { tool: 'rect',       promptForComment: true  },
          { tool: 'ellipse',    promptForComment: true  },
          { tool: 'freehand',   promptForComment: false },
          { tool: 'highlighter',promptForComment: false }
        ],
        strokeSizes: [ {label:'S',size:2}, {label:'M',size:6}, {label:'L',size:12} ],
        colors: { palette: ['#E53935','#1E88E5','#43A047','#FFB300'], enablePicker: true },
        export: { asPDF: true }
      },
      // Optional: fine-tune annotation placement on exported PDF
      exportOffset: { x: -89, y: -13.5 },

      // Optional REST API (see "REST API contract")
      // api: {
      //   load:   '/api/annotations/',
      //   create: '/api/annotations/',
      //   update: '/api/annotations/',
      //   delete: '/api/annotations/'
      // }
    });

    // Listen to events
    editor.on('annotation:created',  (a) => console.log('created', a));
    editor.on('annotation:updated',  (a) => console.log('updated', a));
    editor.on('annotation:deleted',  (a) => console.log('deleted', a));
    editor.on('annotation:selected', (a) => console.log('selected', a));
    editor.on('annotation:deselected', () => console.log('deselected'));
  </script>
</body>
</html>
```

```javascript
type VikCraftOptions = {
  pdfPath: string;                // Required: URL/path to PDF
  initialData?: Annotation[];     // Optional: preload annotations
  currentUser?: string;           // For permissions & comment metadata
  exportOffset?: { x: number, y: number };  // Nudge shapes when exporting
  permissions?: {
    allowEdit?: boolean;          // If true, owner can drag/resize
    allowDelete?: boolean;        // If true, owner can delete
  };
  ui?: {
    enableCommentsPanel?: boolean; // Right panel with comments list
  };
  toolbar?: {
    theme?: 'light'|'dark';
    actions?: ('themeToggle')[];
    navigation?: ('prev'|'pageInput'|'next')[];
    zoom?: ('zoomOut'|'zoomIn'|'fitWidth')[];
    drawing?: { tool: Tool; promptForComment?: boolean }[];
    strokeSizes?: { label: string; size: number }[];
    colors?: { palette: string[]; enablePicker?: boolean; };
    export?: { asPDF?: boolean; };
  };
  api?: {
    load: string;   // GET    -> Annotation[]
    create: string; // POST   -> Annotation (with server id)
    update: string; // PUT    -> Annotation (send to `${update}${id}/`)
    delete: string; // DELETE -> (send to `${delete}${id}/`)
  };
}

type Tool = 'select'|'pan'|'rect'|'ellipse'|'freehand'|'highlighter';
```

### Notes
- **Data source:** If `initialData` is provided, it’s used. Otherwise, when `api` is configured, annotations load from `api.load`.
- **Permissions:** Edit/Delete in the context menu are allowed only when `annotation.user === currentUser` **and** permissions permit.
- **Zoom:** Starts at `1.5`. `fitWidth` computes per page to match viewer width.

---

### ⚙️ Toolbar

#### Actions
- `themeToggle` — switch light/dark theme.

#### Navigation
- `prev`, `pageInput`, `next`

#### Zoom
- `zoomOut`, `zoomIn`, `fitWidth`  
- **Mouse:** `Ctrl + wheel` to zoom in/out.

#### Drawing tools
- `select` — select/inspect objects
- `pan` — click & drag to pan the viewer
- `rect` / `ellipse` — vector shapes (stroke only)
- `freehand` — Fabric free draw
- `highlighter` — filled rectangle with opacity (selected color + internal opacity suffix)

#### Sizes & colors
- `strokeSizes` — S/M/L values (affect `rect`/`ellipse` & freehand width)
- `colors.palette` — preset colors + optional color picker

#### Export
- `asPDF` — exports a flattened PDF (page image + shapes + optional comment text boxes)

```javascript
editor.on('annotation:created',  (a: Annotation) => {})
editor.on('annotation:updated',  (a: Annotation) => {})
editor.on('annotation:deleted',  (a: {id: string}) => {})
editor.on('annotation:selected', (a: Annotation) => {})
editor.on('annotation:deselected', () => {})
```

Use these to sync with your backend, update UI badges, or analytics.

## 🌍 REST API contract (optional)

If you pass `options.api`, the editor will call these endpoints:

### Endpoints

- **GET** `api.load`  
  **Response:** `Annotation[]`

- **POST** `api.create`  
  **Body:** `Annotation` (client may send a temporary `id`)  
  **Response:** `Annotation` (with **server‑generated** `id`)

- **PUT** ``${api.update}${id}/``  
  **Body:** full `Annotation`  
  **Response:** updated `Annotation`

- **DELETE** ``${api.delete}${id}/``  
  **Response:** `{ "ok": true }` or HTTP `204 No Content`

### Example (Django DRF)
```python
# urls.py
path('api/annotations/', AnnotationListCreateView.as_view()),
path('api/annotations/<str:pk>/', AnnotationRetrieveUpdateDestroyView.as_view()),

# serializers.py
class AnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = ['id','page','user','createdAt','comment','fabric_json']

# views.py (standard DRF generics)
```

**CORS**: enable for your domain.
**Auth**: add your auth headers in ApiService._request if needed.

---

### ⚙️ Annotation schema

```json
{
  "id": "string|number",
  "page": 1,
  "user": "vik",
  "createdAt": "2025-03-15T10:30:00Z",
  "comment": "optional text",
  "fabric_json": {
    "type": "rect",
    "left": 105, "top": 120, "width": 250, "height": 80,
    "stroke": "#E53935", "strokeWidth": 6,
    "fill": "transparent",
    "id": "same-as-annotation-id"
  }
}
```
### Consistency
- Ensure `fabric_json.id` mirrors the annotation `id`.  
  The library sets this automatically when loading/applying annotations.

---

## 🌍 Public methods

Available on the instance:

- `on(eventName, handler)` — register event listeners.
- `renderPage(pageNum: number)` — render a specific page.
- `onPrevPage()` / `onNextPage()` — navigate pages.
- `onZoom('in'|'out'|'fit')` — zoom controls.
- `setActiveTool(tool: Tool)` — switch tools (`'select'|'pan'|'rect'|'ellipse'|'freehand'|'highlighter'`).
- `setStrokeWidth(size: number)` — update current stroke width.
- `setColor(hex: string)` — update current color.
- `focusOnComment(annotationId: string)` — go to page, focus & blink the shape.
- `setTheme('light'|'dark')` / `toggleTheme()` — change UI theme.
- `downloadAnnotatedPdf()` — export a flattened PDF.

> Internal state like `allAnnotations`, `currentPage`, and `zoomScale` exists but should be treated as **private**.

---

## 🎨 Styling & theming

All UI colors are CSS variables. Light/dark is toggled via the `data-theme` attribute.

```css
:root {
  --vc-pdf-bg-primary:#ffffff;
  --vc-pdf-bg-secondary:#f0f2f5;
  --vc-pdf-bg-toolbar:#ffffff;
  --vc-pdf-bg-button:#f8f9fa;
  --vc-pdf-bg-button-hover:#e9ecef;
  --vc-pdf-bg-button-active:#0d6efd;
  --vc-pdf-text-primary:#212529;
  --vc-pdf-text-secondary:#495057;
  --vc-pdf-border-color:#dee2e6;
  --vc-pdf-shadow-color:rgba(0,0,0,0.1);
}

[data-theme="dark"] {
  --vc-pdf-bg-primary:#121212;
  --vc-pdf-bg-secondary:#1e1e1e;
  --vc-pdf-bg-toolbar:#2a2a2a;
  --vc-pdf-bg-button:#404040;
  --vc-pdf-bg-button-hover:#505050;
  --vc-pdf-bg-button-active:#295b9c;
  --vc-pdf-text-primary:#e0e0e0;
  --vc-pdf-text-secondary:#e0e0e0;
  --vc-pdf-border-color:#555;
  --vc-pdf-shadow-color:rgba(0,0,0,0.5);
}
```
The comments panel can be disabled with:

```javascript
ui: { enableCommentsPanel: false }
```

---

## 📊 Export quality & offsets

- Export uses **jsPDF**. Each page is rasterized via **PDF.js** to a temporary high‑DPI canvas, then embedded as **JPEG** into the output PDF.
- If you notice sub‑pixel/DPI shifts between the viewer and the exported PDF, tune the per‑project offsets:

```js
// Editor options
exportOffset: { x: -89, y: -13.5 }
```
- Internally, export uses `renderScale = 2.0`. Increase it if you need sharper output (with larger memory/CPU cost). You can raise it inside `downloadAnnotatedPdf()` if you fork.

---

## 🌍 Integration notes (Django/React/etc.)

### Django
- Serve `VikCraftPDFEditor.js`, `style.css`, and your PDFs via **static files**.
- Expose **DRF** endpoints per the REST contract (load/create/update/delete).
- Accept/return `fabric_json` as **JSON** (object or string). The editor handles both.

### React / Vue / Angular
- Use the library as a **plain ESM module**; mount it into a container `<div>` you control.
- Keep a ref to the instance and **clean up on unmount** if you mount/destroy dynamically.

### Self‑hosting PDF.js
Replace the CDN with your static paths and set the worker explicitly:

```js
import * as pdfjsLib from '/static/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/pdfjs/pdf.worker.mjs';
```

---

## 🧩 Troubleshooting

### Blurry on zoom in viewer
- The viewer re‑renders the PDF page at the current `zoomScale`. If it still looks soft, ensure no CSS transforms are scaling the canvas beyond its intrinsic size.
- Avoid wrapping canvases in scaled containers. Let `renderPage()` own the size.

### Blurry export / misaligned annotations
- Increase `renderScale` in `downloadAnnotatedPdf()` if you fork.
- Use `exportOffset` to correct small x/y shifts.

### CORS / 404 for worker
- The PDF.js worker must be reachable at `pdf.worker.mjs`.
- If using a CSP, allow `worker-src` and `script-src` for your PDF.js origin.

### Permissions not respected
- `currentUser` must match `annotation.user` to enable edit/delete.
- Ensure `permissions.allowEdit` and/or `permissions.allowDelete` are `true`.

### Duplicate annotation IDs
- Your backend must return unique `id` values. The editor generates `temp-<timestamp>` locally until the `create` response arrives.

---

## 🧩 Roadmap
- Text annotations & callouts  
- Shapes palette (arrow, polyline, polygon)  
- Per‑annotation ACLs and roles  
- Layered export (retain vector where possible)  
- Mobile pinch‑zoom & gestures

---

## 📜 License

This project is developed by Nitish Srivastava with help of Gemini AI.