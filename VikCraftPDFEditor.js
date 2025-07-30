import * as pdfjsLib from "https://mozilla.github.io/pdf.js/build/pdf.mjs";
const { jsPDF } = window.jspdf;

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://mozilla.github.io/pdf.js/build/pdf.worker.mjs";

class ApiService {
    constructor(endpoints) { this.endpoints = endpoints; }
    async _request(url, method, body = null) {
        try {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) { console.error(`API Error (${method} ${url}):`, error); throw error; }
    }
    load() { return this._request(this.endpoints.load, 'GET'); }
    create(data) { return this._request(this.endpoints.create, 'POST', data); }
    update(data) { return this._request(this.endpoints.update + data.id + '/', 'PUT', data); }
    delete(id) { return this._request(this.endpoints.delete + id + '/', 'DELETE'); }
}

class VikCraftPDFEditor {
    constructor(containerId, options) {
        this.container = document.getElementById(containerId);
        if (!this.container) { console.error("Editor container not found!"); return; }

        this.options = options;
        this._eventListeners = {};
        this.pdfPath = options.pdfPath;
        this.api = options.api ? new ApiService(options.api) : null;
        
        this.pdfDoc = null; this.currentPage = 1; this.zoomScale = 1.5;
        this.fabricCanvas = null; this.isDrawing = false; this.activeShape = null;
        this.allAnnotations = []; this.activeTool = 'select'; this.activeColor = '#E53935';
        this.activeStrokeWidth = options.toolbar?.strokeSizes?.[1]?.size || 6;
        this.highlighterOpacity = '80'; this.editingAnnotation = null;
        this.isPanning = false; this.lastPanPoint = { x: 0, y: 0 };

        this._createDOM();
        this.init();
    }
    
    _createDOM() {
        const hasCommentsPanel = this.options.ui?.enableCommentsPanel !== false;

        this.container.innerHTML = `
            <div class="vc-pdf-main-grid ${hasCommentsPanel ? '' : 'single-column'}">
                <div class="vc-pdf-viewer-wrapper">
                    <div id="vc-pdf-toolbar"></div>
                    <div id="vc-pdf-viewer-main">
                        <canvas id="vc-pdf-pdf-canvas"></canvas>
                        <canvas id="vc-pdf-annotation-canvas"></canvas>
                        <div id="vc-pdf-context-menu"></div> 
                    </div>
                </div>
                ${hasCommentsPanel ? `
                <div class="vc-pdf-comments-panel">
                    <div class="vc-pdf-comments-header">All Comments</div>
                    <div id="vc-pdf-comments-list"></div>
                </div>` : ''}
            </div>
            <div id="vc-pdf-comment-modal"></div>
            <div id="vc-pdf-loader-overlay"></div>
            <div id="vc-pdf-tooltip"></div>
        `;
        this.container.querySelector('#vc-pdf-comment-modal').innerHTML = `<div class="vc-pdf-modal-content"><h4 id="vc-pdf-comment-modal-title">Add Comment</h4><textarea id="vc-pdf-comment-text" rows="4"></textarea><div class="vc-pdf-modal-buttons"><button id="vc-pdf-comment-cancel">Cancel</button><button id="vc-pdf-comment-save">Save</button></div></div>`;
        this.container.querySelector('#vc-pdf-context-menu').innerHTML = `<button data-action="edit" title="Edit Comment"><i class="fas fa-pencil-alt"></i></button><button data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>`;
        this.container.querySelector('#vc-pdf-loader-overlay').innerHTML = `<div class="vc-pdf-loader-content"><div class="vc-pdf-spinner"></div><p id="vc-pdf-loader-message">Please wait...</p></div>`;
    }

    async init() {
        this.viewerMain = this.container.querySelector('#vc-pdf-viewer-main');
        this.toolbar = this.container.querySelector('#vc-pdf-toolbar');
        this.loader = this.container.querySelector('#vc-pdf-loader-overlay');
        this.commentModal = this.container.querySelector('#vc-pdf-comment-modal');
        this.commentText = this.container.querySelector('#vc-pdf-comment-text');
        this.contextMenu = this.container.querySelector('#vc-pdf-context-menu');
        this.pdfCanvas = this.container.querySelector('#vc-pdf-pdf-canvas');
        this.pdfCtx = this.pdfCanvas.getContext('2d');
        this.tooltip = this.container.querySelector('#vc-pdf-tooltip');
        this.commentsList = this.container.querySelector('#vc-pdf-comments-list');
        this.setTheme(this.options.toolbar?.theme || 'light');
        this._buildToolbar();
        this.pageInput = this.container.querySelector('#vc-pdf-page-num-input');
        this.pageCountDisplay = this.container.querySelector('#vc-pdf-page-count');
        this.fabricCanvas = new fabric.Canvas('vc-pdf-annotation-canvas');
        this.setupEventListeners();
        await this.loadDocument();
    }

    _buildToolbar() {
        const tb = this.options.toolbar; if (!tb) return;
        this.toolbar.innerHTML = '';
        const toolMap = {
            themeToggle: `<button id="vc-pdf-theme-toggle" title="Toggle Theme"><i class="fas fa-moon"></i></button>`,
            pan: `<button data-tool="pan" title="Pan Tool"><i class="fas fa-hand-paper"></i></button>`,
            prev: `<button id="vc-pdf-prev-page" title="Previous Page"><i class="fas fa-arrow-left"></i></button>`,
            next: `<button id="vc-pdf-next-page" title="Next Page"><i class="fas fa-arrow-right"></i></button>`,
            pageInput: `<input type="number" id="vc-pdf-page-num-input" value="1" min="1"><span class="vc-pdf-page-indicator">/ <span id="vc-pdf-page-count">--</span></span>`,
            zoomIn: `<button id="vc-pdf-zoom-in" title="Zoom In"><i class="fas fa-search-plus"></i></button>`,
            zoomOut: `<button id="vc-pdf-zoom-out" title="Zoom Out"><i class="fas fa-search-minus"></i></button>`,
            fitWidth: `<button id="vc-pdf-fit-width" title="Fit to Width"><i class="fas fa-arrows-alt-h"></i></button>`,
            select: `<button data-tool="select" title="Select"><i class="fas fa-mouse-pointer"></i></button>`,
            rect: `<button data-tool="rect" title="Rectangle"><i class="far fa-square"></i></button>`,
            ellipse: `<button data-tool="ellipse" title="Circle"><i class="far fa-circle"></i></button>`,
            freehand: `<button data-tool="freehand" title="Pen"><i class="fas fa-pencil-alt"></i></button>`,
            highlighter: `<button data-tool="highlighter" title="Highlighter"><i class="fas fa-highlighter"></i></button>`,
            asPDF: `<button id="vc-pdf-export-pdf" title="Download Annotated PDF"><i class="fas fa-file-pdf"></i></button>`
        };
        const createGroup = (tools, id = '') => {
            const group = document.createElement('div');
            group.className = 'vc-pdf-tool-group'; if (id) group.id = `vc-pdf-${id}`;
            tools.forEach(tool => {
                if (typeof tool === 'object') { group.innerHTML += toolMap[tool.tool] || ''; } 
                else { group.innerHTML += toolMap[tool] || ''; }
            });
            return group;
        };
        const groups = [];
        if (tb.actions) groups.push(createGroup(tb.actions));
        if (tb.navigation) groups.push(createGroup(tb.navigation));
        if (tb.zoom) groups.push(createGroup(tb.zoom));
        if (tb.drawing) groups.push(createGroup(tb.drawing, 'drawing-tools'));
        if (tb.strokeSizes && tb.strokeSizes.length > 0) {
            const sizeGroup = document.createElement('div');
            sizeGroup.className = 'vc-pdf-tool-group'; sizeGroup.id = 'vc-pdf-size-selector';
            tb.strokeSizes.forEach(stroke => { sizeGroup.innerHTML += `<button data-size="${stroke.size}" title="${stroke.label} Size">${stroke.label}</button>`; });
            groups.push(sizeGroup);
        }
        if (tb.colors && tb.colors.palette) {
            const colorGroup = document.createElement('div');
            colorGroup.className = 'vc-pdf-tool-group'; colorGroup.id = 'vc-pdf-color-palette';
            tb.colors.palette.forEach(color => { colorGroup.innerHTML += `<div class="vc-pdf-color-box" data-color="${color}" style="background: ${color};"></div>`; });
            if (tb.colors.enablePicker) { colorGroup.innerHTML += `<input type="color" id="vc-pdf-color-picker" value="${this.activeColor}" title="Custom Color">`; }
            groups.push(colorGroup);
        }
        if (tb.export && tb.export.asPDF) groups.push(createGroup(['asPDF']));
        groups.forEach((group, index) => {
            this.toolbar.appendChild(group);
            if (index < groups.length - 1 && group.hasChildNodes()) {
                const spacer = document.createElement('div'); spacer.className = 'vc-pdf-spacer'; this.toolbar.appendChild(spacer);
            }
        });
    }

    setupEventListeners() {
        if (this.toolbar) {
            this.toolbar.addEventListener('click', (e) => {
                const button = e.target.closest('button');
                if (button) {
                    const tool = button.dataset.tool; const id = button.id;
                    if (tool) this.setActiveTool(tool);
                    else if (id === 'vc-pdf-theme-toggle') this.toggleTheme();
                    else if (id === 'vc-pdf-prev-page') this.onPrevPage(); else if (id === 'vc-pdf-next-page') this.onNextPage();
                    else if (id === 'vc-pdf-zoom-in') this.onZoom('in'); else if (id === 'vc-pdf-zoom-out') this.onZoom('out');
                    else if (id === 'vc-pdf-fit-width') this.onZoom('fit'); else if (id === 'vc-pdf-export-pdf') this.downloadAnnotatedPdf();
                }
                const colorBox = e.target.closest('.vc-pdf-color-box'); if (colorBox) this.setColor(colorBox.dataset.color);
                const sizeButton = e.target.closest('#vc-pdf-size-selector button'); if (sizeButton) this.setStrokeWidth(parseInt(sizeButton.dataset.size, 10));
            });
        }
        if (this.pageInput) this.pageInput.addEventListener('change', this.goToPage.bind(this));
        const colorPicker = this.container.querySelector('#vc-pdf-color-picker');
        if (colorPicker) colorPicker.addEventListener('input', (e) => this.setColor(e.target.value));
        if (this.commentModal) {
            this.commentModal.querySelector('#vc-pdf-comment-save').addEventListener('click', this.saveComment.bind(this));
            this.commentModal.querySelector('#vc-pdf-comment-cancel').addEventListener('click', this.cancelComment.bind(this));
        }
        if (this.contextMenu) {
            this.contextMenu.addEventListener('click', (e) => {
                const action = e.target.closest('button')?.dataset.action;
                if (action === 'edit') this._handleEdit(); else if (action === 'delete') this._handleDelete();
            });
        }
        if (this.commentsList) {
            this.commentsList.addEventListener('click', (e) => {
                const card = e.target.closest('.vc-pdf-comment-card');
                if (card && card.dataset.id) this.focusOnComment(card.dataset.id);
            });
        }
        if (this.viewerMain) {
            this.viewerMain.addEventListener('mousedown', (e) => {
                if (this.activeTool === 'pan') {
                    this.isPanning = true; this.lastPanPoint = { x: e.clientX, y: e.clientY };
                    this.viewerMain.classList.add('is-panning');
                }
            });
            this.viewerMain.addEventListener('mousemove', (e) => {
                if (this.isPanning) {
                    const dx = e.clientX - this.lastPanPoint.x; const dy = e.clientY - this.lastPanPoint.y;
                    this.viewerMain.scrollLeft -= dx; this.viewerMain.scrollTop -= dy;
                    this.lastPanPoint = { x: e.clientX, y: e.clientY };
                }
            });
            this.viewerMain.addEventListener('mouseup', () => {
                this.isPanning = false; this.viewerMain.classList.remove('is-panning');
            });
            this.viewerMain.addEventListener('mouseleave', () => {
                this.isPanning = false; this.viewerMain.classList.remove('is-panning');
            });
            this.viewerMain.addEventListener('wheel', (e) => {
                if (e.ctrlKey) {
                    e.preventDefault(); const delta = e.deltaY > 0 ? 'out' : 'in'; this.onZoom(delta);
                }
            }, { passive: false });
        }
        if (this.fabricCanvas) {
            this.fabricCanvas.on({
                'mouse:down': this.handleMouseDown.bind(this),
                'mouse:move': (e) => { this.handleMouseMove(e); this._handleTooltipMove(e); },
                'mouse:up': this.handleMouseUp.bind(this), 'path:created': this.handlePathCreated.bind(this),
                'selection:created': (e) => { this._showContextualMenu(e.selected[0]); this._highlightCommentCard(e.selected[0].id); this._fire('annotation:selected', this.allAnnotations.find(a => a.id === e.selected[0].id)); },
                'selection:updated': (e) => { this._showContextualMenu(e.selected[0]); this._highlightCommentCard(e.selected[0].id); this._fire('annotation:selected', this.allAnnotations.find(a => a.id === e.selected[0].id)); },
                'selection:cleared': () => { this._hideContextualMenu(); this._highlightCommentCard(null); this._fire('annotation:deselected'); },
                'mouse:over': (e) => this._showTooltip(e), 'mouse:out': this._hideTooltip.bind(this),
                'object:modified': this._handleObjectModified.bind(this),
            });
        }
    }

    on(eventName, callback) {
        if (!this._eventListeners[eventName]) { this._eventListeners[eventName] = []; }
        this._eventListeners[eventName].push(callback);
    }
    _fire(eventName, data) {
        if (this._eventListeners[eventName]) {
            this._eventListeners[eventName].forEach(callback => { try { callback(data); } catch (e) { console.error(`Error in '${eventName}' event listener:`, e); } });
        }
    }

    async addAnnotation(fabricObject) {
        if (!fabricObject) return;
        const toolConfig = this.options.toolbar.drawing.find(d => d.tool === this.activeTool);
        const annotationId = `temp-${Date.now()}`;
        fabricObject.set('id', annotationId);
        const newAnnotation = {
            id: annotationId, page: this.currentPage, user: this.options.currentUser || 'Guest',
            createdAt: new Date().toISOString(), fabric_json: fabricObject.toJSON(['id']), comment: '',
        };
        this._fire('annotation:created', newAnnotation);
        if (toolConfig?.promptForComment) {
            this._promptForComment(newAnnotation, true);
        } else if (this.api) {
            try {
                const savedAnnotation = await this.api.create(newAnnotation);
                newAnnotation.id = savedAnnotation.id;
                fabricObject.set('id', savedAnnotation.id);
                this.allAnnotations.push(savedAnnotation);
            } catch (error) { this.fabricCanvas.remove(fabricObject); }
        } else {
            this.allAnnotations.push(newAnnotation);
        }
    }

    async loadDocument() {
        try {
            this.loader.style.display = 'flex';
            
            if (this.options.initialData) { this.allAnnotations = this.options.initialData; } 
            else if (this.api) { this.allAnnotations = await this.api.load(); }
            if (this.options.ui?.enableCommentsPanel !== false) {
                this._renderCommentsList();
            }
            const pdfTask = pdfjsLib.getDocument(this.pdfPath);
            this.pdfDoc = await pdfTask.promise;
            if (this.pageCountDisplay) this.pageCountDisplay.textContent = this.pdfDoc.numPages;
            if (this.pageInput) this.pageInput.max = this.pdfDoc.numPages;
            this.setActiveTool('select');
            this.setColor(this.activeColor);
            this.setStrokeWidth(this.activeStrokeWidth);
            await this.renderPage(1);
        } catch (error) { console.error("Error loading document:", error); } 
        finally { this.loader.style.display = 'none'; }
    }
    _renderCommentsList() {
        if (!this.commentsList) return;
        this.commentsList.innerHTML = '';
        const comments = this.allAnnotations.filter(a => a.comment);
        if (comments.length === 0) {
            this.commentsList.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--vc-pdf-text-secondary);">No comments yet.</div>`;
            return;
        }
        comments.forEach(anno => {
            const card = document.createElement('div');
            card.className = 'vc-pdf-comment-card';
            card.dataset.id = anno.id;
            card.innerHTML = `<div class="vc-pdf-comment-card-header"><span class="vc-pdf-comment-user">${anno.user || 'Guest'}</span><span class="vc-pdf-comment-page">Page ${anno.page}</span></div><div class="vc-pdf-comment-body">${anno.comment}</div>`;
            this.commentsList.appendChild(card);
        });
    }
    _highlightCommentCard(annotationId) {
        if (!this.commentsList) return;
        this.commentsList.querySelectorAll('.vc-pdf-comment-card').forEach(card => {
            card.classList.toggle('active', card.dataset.id === annotationId);
        });
        if (annotationId) {
            const activeCard = this.commentsList.querySelector(`[data-id="${annotationId}"]`);
            if (activeCard) activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    _promptForComment(annotation, isCreating = false) {
        this.editingAnnotation = annotation;
        this.container.querySelector('#vc-pdf-comment-modal-title').textContent = isCreating ? 'Add Comment' : 'Edit Comment';
        this.commentText.value = annotation.comment || '';
        this.commentModal.classList.add('visible');
        this.commentText.focus();
    }
    async saveComment() {
        if (!this.editingAnnotation) return;
        this.editingAnnotation.comment = this.commentText.value.trim();
        let savedAnnotation = this.editingAnnotation;
        if (this.api) {
            const isCreating = this.editingAnnotation.id.toString().startsWith('temp-');
            try {
                savedAnnotation = isCreating ? await this.api.create(this.editingAnnotation) : await this.api.update(this.editingAnnotation);
                const fabricObject = this.fabricCanvas.getObjects().find(o => o.id === this.editingAnnotation.id);
                if (fabricObject) fabricObject.set('id', savedAnnotation.id);
                if (isCreating) { this.allAnnotations.push(savedAnnotation); } 
                else {
                    const index = this.allAnnotations.findIndex(a => a.id === savedAnnotation.id);
                    if (index !== -1) this.allAnnotations[index] = savedAnnotation;
                }
            } catch (error) {
                if(isCreating) {
                    const fabricObject = this.fabricCanvas.getObjects().find(o => o.id === this.editingAnnotation.id);
                    if(fabricObject) this.fabricCanvas.remove(fabricObject);
                }
            }
        }
        this.cancelComment();
        this._renderCommentsList();
        this._fire('annotation:updated', savedAnnotation);
    }
    cancelComment() {
        this.commentModal.classList.remove('visible');
        this.commentText.value = '';
        if (this.editingAnnotation && this.editingAnnotation.id.toString().startsWith('temp-') && !this.editingAnnotation.comment) {
             const fabricObject = this.fabricCanvas.getObjects().find(o => o.id === this.editingAnnotation.id);
             if(fabricObject) this.fabricCanvas.remove(fabricObject);
        }
        this.editingAnnotation = null;
    }
    _showContextualMenu(fabricObject) {
        this._hideTooltip();
        const annotation = this.allAnnotations.find(a => a.id === fabricObject.id);
        if (!annotation) return;
        const menu = this.contextMenu; menu.innerHTML = '';
        const canEdit = this.options.permissions?.allowEdit && annotation.user === this.options.currentUser;
        const canDelete = this.options.permissions?.allowDelete && annotation.user === this.options.currentUser;
        if (canEdit) { menu.innerHTML += `<button data-action="edit" title="Edit Comment"><i class="fas fa-pencil-alt"></i></button>`; }
        if (canDelete) { menu.innerHTML += `<button data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>`; }
        if (!canEdit && !canDelete) return;
        const pos = fabricObject.getCoords(true, true)[1];
        menu.style.left = `${pos.x + 10}px`; menu.style.top = `${pos.y - 10}px`;
        menu.classList.add('visible');
    }
    _hideContextualMenu() { this.contextMenu.classList.remove('visible'); }
    _handleEdit() {
        const activeObject = this.fabricCanvas.getActiveObject();
        if (!activeObject) return;
        const annotation = this.allAnnotations.find(a => a.id === activeObject.id);
        const canEdit = this.options.permissions?.allowEdit && annotation?.user === this.options.currentUser;
        if (annotation && canEdit) { this._promptForComment(annotation, false); }
        this._hideContextualMenu();
    }
    async _handleDelete() {
        const activeObject = this.fabricCanvas.getActiveObject();
        if (!activeObject) return;
        const annotation = this.allAnnotations.find(a => a.id === activeObject.id);
        const canDelete = this.options.permissions?.allowDelete && annotation?.user === this.options.currentUser;
        if (!annotation || !canDelete) { this._hideContextualMenu(); return; }
        if (window.confirm('Are you sure you want to delete this annotation?')) {
            const idToDelete = activeObject.id;
            if (this.api) {
                try {
                    await this.api.delete(idToDelete);
                    this.allAnnotations = this.allAnnotations.filter(a => a.id !== idToDelete);
                    this.fabricCanvas.remove(activeObject);
                    this._fire('annotation:deleted', { id: idToDelete });
                } catch (error) { console.error("Failed to delete annotation:", error); }
            } else {
                this.allAnnotations = this.allAnnotations.filter(a => a.id !== idToDelete);
                this.fabricCanvas.remove(activeObject);
                this._fire('annotation:deleted', { id: idToDelete });
            }
            this._renderCommentsList();
        }
        this._hideContextualMenu();
    }
    _showTooltip(e) {
        if (!e.target || this.contextMenu.classList.contains('visible')) return;
        const annotation = this.allAnnotations.find(a => a.id === e.target.id);
        if (annotation && (annotation.comment || annotation.user)) {
            const date = annotation.createdAt ? new Date(annotation.createdAt).toLocaleString() : '';
            this.tooltip.innerHTML = `<div class="comment-user">${annotation.user || 'Guest'}</div><div class="comment-time">${date}</div><div class="comment-body">${annotation.comment || '<i>No comment</i>'}</div>`;
            this.tooltip.style.left = `${e.e.clientX + 15}px`;
            this.tooltip.style.top = `${e.e.clientY + 15}px`;
            this.tooltip.classList.add('visible');
        }
    }
    _hideTooltip() { this.tooltip.classList.remove('visible'); }
    _handleTooltipMove(e) {
        if (this.tooltip.classList.contains('visible')) {
            this.tooltip.style.left = `${e.e.clientX + 15}px`;
            this.tooltip.style.top = `${e.e.clientY + 15}px`;
        }
    }
    async focusOnComment(id) {
        const annotation = this.allAnnotations.find(a => a.id === id);
        if (!annotation) { console.warn(`Annotation with ID ${id} not found.`); return; }
        this._highlightCommentCard(id);
        if (this.currentPage !== annotation.page) { await this.renderPage(annotation.page); }
        const fabricObject = this.fabricCanvas.getObjects().find(o => o.id === id);
        if (fabricObject) {
            this.fabricCanvas.setActiveObject(fabricObject).renderAll();
            const objCenter = fabricObject.getCenterPoint();
            this.viewerMain.scrollTo({
                left: (objCenter.x * this.zoomScale) - (this.viewerMain.clientWidth / 2),
                top: (objCenter.y * this.zoomScale) - (this.viewerMain.clientHeight / 2),
                behavior: 'smooth'
            });
            const originalColor = fabricObject.stroke;
            fabricObject.set('stroke', '#0d6efd');
            this.fabricCanvas.renderAll();
            setTimeout(() => {
                fabricObject.set('stroke', originalColor);
                this.fabricCanvas.renderAll();
            }, 1000);
        }
    }
    setTheme(theme) {
        this.container.dataset.theme = theme;
        const icon = this.container.querySelector('#vc-pdf-theme-toggle i');
        if (icon) { icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'; }
    }
    toggleTheme() {
        const newTheme = this.container.dataset.theme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }
    async renderPage(pageNum) {
        if (!this.pdfDoc) return;
        this.fabricCanvas.clear(); this._hideContextualMenu();
        this.currentPage = pageNum; if(this.pageInput) this.pageInput.value = pageNum;
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.zoomScale });
        this.pdfCanvas.height = viewport.height; this.pdfCanvas.width = viewport.width;
        this.fabricCanvas.setDimensions({ width: viewport.width, height: viewport.height });
        this.fabricCanvas.setZoom(this.zoomScale);
        await page.render({ canvasContext: this.pdfCtx, viewport }).promise;
        await this.loadAnnotationsForPage(pageNum);
    }
    loadAnnotationsForPage(pageNum) {
        return new Promise(resolve => {
            const annotations = this.allAnnotations.filter(a => a.page === pageNum);
            if (annotations.length === 0) { resolve(); return; }
            const fabricObjects = annotations.map(a => {
                const fabricJson = typeof a.fabric_json === 'string' ? JSON.parse(a.fabric_json) : a.fabric_json;
                fabricJson.id = a.id;
                return fabricJson;
            });
            this.fabricCanvas.loadFromJSON({ objects: fabricObjects }, () => {
                this.fabricCanvas.getObjects().forEach((obj, index) => {
                    if (!obj.id) obj.set('id', annotations[index].id);
                    const annotation = annotations[index];
                    const isOwner = annotation.user === this.options.currentUser;
                    const canModify = this.options.permissions?.allowEdit && isOwner;
                    obj.set({
                        selectable: this.activeTool === 'select',
                        lockMovementX: !canModify, lockMovementY: !canModify,
                        lockScalingX: !canModify, lockScalingY: !canModify,
                        lockRotation: true, hasControls: canModify
                    });
                });
                this.fabricCanvas.renderAll();
                resolve();
            });
        });
    }
    setActiveTool(tool) {
        this.activeTool = tool;
        this.fabricCanvas.isDrawingMode = tool === 'freehand';
        const isInteractive = tool !== 'pan';
        this.fabricCanvas.selection = isInteractive && tool === 'select';
        this.fabricCanvas.getObjects().forEach(obj => {
            obj.set({ selectable: isInteractive && tool === 'select', evented: isInteractive });
        });
        this.viewerMain.classList.toggle('pan-mode', tool === 'pan');
        if (tool === 'freehand') {
            this.fabricCanvas.freeDrawingBrush.width = this.activeStrokeWidth;
            this.fabricCanvas.freeDrawingBrush.color = this.activeColor;
        }
        const drawingTools = this.container.querySelector('#vc-pdf-drawing-tools');
        if(drawingTools) {
            drawingTools.querySelectorAll('button').forEach(btn => {
                const toolConfig = this.options.toolbar.drawing.find(d => d.tool === btn.dataset.tool);
                if(toolConfig) btn.classList.toggle('active', toolConfig.tool === tool);
            });
        }
        if(tool !== 'select') this.fabricCanvas.discardActiveObject().renderAll();
        this._hideContextualMenu();
        this.fabricCanvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
    }
    setStrokeWidth(size) {
        this.activeStrokeWidth = size;
        if (this.fabricCanvas.isDrawingMode) {
            this.fabricCanvas.freeDrawingBrush.width = size;
        }
        const sizeSelector = this.container.querySelector('#vc-pdf-size-selector');
        if(sizeSelector) {
            sizeSelector.querySelectorAll('button').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === size);
            });
        }
    }
    setColor(color) {
        this.activeColor = color;
        if (this.fabricCanvas.isDrawingMode) {
             this.fabricCanvas.freeDrawingBrush.color = color;
        }
        const colorPalette = this.container.querySelector('#vc-pdf-color-palette');
        if(colorPalette) {
            colorPalette.querySelectorAll('.vc-pdf-color-box').forEach(box => {
                box.classList.toggle('active', box.dataset.color.toLowerCase() === color.toLowerCase());
            });
        }
    }
    handleMouseDown(o) {
        if (this.activeTool === 'pan' || this.fabricCanvas.isDrawingMode || this.activeTool === 'select') return;
        this.isDrawing = true;
        const pointer = this.fabricCanvas.getPointer(o.e);
        this.drawingStartPos = { x: pointer.x, y: pointer.y };
        let shape;
        const options = { left: pointer.x, top: pointer.y, width: 0, height: 0, selectable: false, };
        if (this.activeTool === 'rect' || this.activeTool === 'ellipse') {
            const shapeOptions = { ...options, stroke: this.activeColor, strokeWidth: this.activeStrokeWidth, fill: 'transparent' };
            shape = this.activeTool === 'rect' ? new fabric.Rect(shapeOptions) : new fabric.Ellipse({ ...shapeOptions, rx: 0, ry: 0 });
        } else if (this.activeTool === 'highlighter') {
            shape = new fabric.Rect({ ...options, fill: this.activeColor + this.highlighterOpacity, strokeWidth: 0 });
        }
        this.activeShape = shape;
        if (this.activeShape) this.fabricCanvas.add(this.activeShape);
    }
    handleMouseMove(o) {
        if (!this.isDrawing || !this.activeShape) return;
        const pointer = this.fabricCanvas.getPointer(o.e);
        const w = Math.abs(this.drawingStartPos.x - pointer.x);
        const h = Math.abs(this.drawingStartPos.y - pointer.y);
        this.activeShape.set({
            left: Math.min(this.drawingStartPos.x, pointer.x),
            top: Math.min(this.drawingStartPos.y, pointer.y),
            width: w, height: h,
        });
        if (this.activeShape.type === 'ellipse') this.activeShape.set({ rx: w/2, ry: h/2 });
        this.fabricCanvas.renderAll();
    }
    handleMouseUp() {
        if (this.isDrawing) {
            this.addAnnotation(this.activeShape);
            this.isDrawing = false;
            this.activeShape = null;
        }
    }
    handlePathCreated(e) { this.addAnnotation(e.path); }
    async _handleObjectModified(e) {
        const modifiedObject = e.target;
        if (!modifiedObject || !modifiedObject.id) return;
        const annotation = this.allAnnotations.find(a => a.id === modifiedObject.id);
        if (annotation) {
            annotation.fabric_json = modifiedObject.toJSON(['id']);
            this._fire('annotation:updated', annotation);
            if (this.api) {
                try { await this.api.update(annotation); }
                catch (error) { console.error("Failed to save updated annotation:", error); }
            }
        }
    }
    async downloadAnnotatedPdf() {
        if (!this.pdfDoc) return;
        this.loader.style.display = 'flex';
        const newPdf = new jsPDF({ orientation: 'p', unit: 'pt' });
        const renderScale = 2.0;
        const offsetX = this.options.exportOffset?.x || 0;
        const offsetY = this.options.exportOffset?.y || 0;

        try {
            for (let i = 1; i <= this.pdfDoc.numPages; i++) {
                this.container.querySelector('#vc-pdf-loader-message').textContent = `Processing page ${i} of ${this.pdfDoc.numPages}...`;
                const page = await this.pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: renderScale });
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = viewport.width;
                tempCanvas.height = viewport.height;
                const tempCtx = tempCanvas.getContext('2d');
                await page.render({ canvasContext: tempCtx, viewport }).promise;

                const annotations = this.allAnnotations.filter(a => a.page === i);
                if (annotations.length > 0) {
                    const tempFabric = new fabric.StaticCanvas(null, { width: viewport.width, height: viewport.height });
                    
                    const fabricObjects = annotations.map(a => {
                        const json = typeof a.fabric_json === 'string' ? JSON.parse(a.fabric_json) : a.fabric_json;
                        json.left += offsetX;
                        json.top += offsetY;
                        return json;
                    });
                    
                    await new Promise(resolve => tempFabric.loadFromJSON({ objects: fabricObjects }, resolve));

                    const shapes = [...tempFabric.getObjects()];
                    for (const shape of shapes) {
                        const annotation = annotations.find(a => a.id === shape.id);
                        if (annotation && annotation.comment) {
                            // Scale the shape's properties to get the correct bounding box on the high-res canvas
                            shape.scaleX *= renderScale;
                            shape.scaleY *= renderScale;
                            const bounds = shape.getBoundingRect();
                            
                            // --- NEW AND CORRECTED TEXTBOX LOGIC ---
                            const text = new fabric.Textbox(annotation.comment, {
                                width: bounds.width < (150 * renderScale) ? (150 * renderScale) : bounds.width,
                                fontSize: 8 * renderScale,
                                fill: shape.stroke || '#000000',
                                backgroundColor: '#FFFFFF',
                                textAlign: 'left',
                                
                                // ** THE FIX IS HERE **
                                left: bounds.left,
                                top: bounds.top - (3 * renderScale), // 3px margin above the shape
                                originY: 'bottom' // Anchor the textbox from its bottom edge
                            });
                            
                            tempFabric.add(text);
                        }
                    }
                    
                    tempFabric.renderAll();
                    tempCtx.drawImage(tempFabric.getElement(), 0, 0);
                }
                
                const imgData = tempCanvas.toDataURL({ format: 'jpeg', quality: 0.9 });
                const pdfPageSize = page.getViewport({ scale: 1 });
                const orientation = pdfPageSize.width > pdfPageSize.height ? 'l' : 'p';
                if (i > 1) { newPdf.addPage([pdfPageSize.width, pdfPageSize.height], orientation); }
                else { newPdf.internal.pageSize.setWidth(pdfPageSize.width); newPdf.internal.pageSize.setHeight(pdfPageSize.height); }
                newPdf.addImage(imgData, 'JPEG', 0, 0, newPdf.internal.pageSize.getWidth(), newPdf.internal.pageSize.getHeight());
            }
            newPdf.save('VikCraftEditor-Annotated.pdf');
        } catch (error) {
            console.error("Failed to generate annotated PDF:", error);
        } finally {
            this.loader.style.display = 'none';
        }
    }
    onPrevPage() { if (this.currentPage > 1) this.renderPage(--this.currentPage); }
    onNextPage() { if (this.currentPage < this.pdfDoc.numPages) this.renderPage(++this.currentPage); }
    goToPage() {
        if(!this.pageInput) return;
        const num = parseInt(this.pageInput.value, 10);
        if (num >= 1 && num <= this.pdfDoc.numPages) this.renderPage(num);
    }
    onZoom(level) {
        if (!this.pdfDoc) return;
        if (level === 'in') this.zoomScale += 0.25;
        else if (level === 'out') this.zoomScale = Math.max(0.25, this.zoomScale - 0.25);
        else if (level === 'fit') {
            this.pdfDoc.getPage(this.currentPage).then(page => {
                const container = this.container.querySelector('#vc-pdf-viewer-main');
                if (container) this.zoomScale = (container.clientWidth - 40) / page.getViewport({ scale: 1 }).width;
                this.renderPage(this.currentPage);
            });
            return;
        }
        this.renderPage(this.currentPage);
    }
}

export default VikCraftPDFEditor;