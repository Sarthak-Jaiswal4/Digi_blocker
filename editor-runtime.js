import { z } from "zod";

//
// 🔹 Base reusable schemas
//

const ColorSchema = z.object({
  background: z.string().optional(),
  border: z.string().optional(),
});

const NodeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  baseLabel: z.string().optional(),
  type: z.string(),
  tfValue: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  fixed: z.boolean().optional(),
  shape: z.string().optional(),
  size: z.number().optional(),
  style: z.string().optional(),
  latex_tf: z.string().optional(),
  latex_exp: z.string().optional(),
  color: ColorSchema.optional(),
});

const EdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  tf: z.string().optional(),
  weight: z.string().optional(),
});

//
// 🔹 Graph
//

const GraphSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  datatype: z.string().optional(),
});

//
// 🔹 Feedback loop
//

const FeedbackSchema = z.object({
  summer: z.string(),
  takeoff: z.string(),
  fwd: z.array(z.string()),
  fdbk: z.array(z.string()),
  fwd_edges: z.array(EdgeSchema),
  fdbk_edges: z.array(EdgeSchema),
});

//
// 🔹 BD step (union of tuple types)
//

const BdStepSchema = z.union([
  z.tuple([z.string(), z.string(), GraphSchema]),
  z.tuple([z.string(), FeedbackSchema, GraphSchema]),
  z.tuple([z.string(), z.array(z.string()), GraphSchema]),
]);

//
// 🔹 SFG
//

const PathSchema = z.object({
  nodes: z.array(z.string()),
  gain: z.string(),
  delta_k: z.string(),
  delta_k_expansion: z.array(z.any()),
});

const LoopSchema = z.object({
  nodes: z.array(z.string()),
  gain: z.string(),
});

const DeltaExpansionSchema = z.object({
  order: z.number(),
  combinations: z.array(
    z.object({
      loops: z.array(z.number()),
      gain: z.string(),
    })
  ),
  sum: z.string(),
});

const SfgInnerSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      weight: z.string(),
    })
  ),
});

const SfgSchema = z.object({
  sfg: SfgInnerSchema,
  paths: z.array(PathSchema),
  loops: z.array(LoopSchema),
  delta: z.string(),
  delta_expansion: z.array(DeltaExpansionSchema),
  numerator: z.string(),
  transfer_function: z.string(),
  transfer_function_tf: z.string(),
});

//
// 🔹 FINAL ROOT
//

const FinalSchema = z.object({
  bd: z.array(BdStepSchema),
  sfg: SfgSchema,
  original: GraphSchema,
});

const DEFAULT_SCENE = { width: 4000, height: 2500 };
const STORAGE_KEY = 'digiblocker-diagram';
const BACKEND_URL = 'https://redirect-k8dk.onrender.com/solve';
const MAX_HISTORY = 100;
const ROUTE = {
    stub: 34,
    nodePadding: 28,
    loopDrop: 130,
    minLaneGap: 70
};

const NODE_LIBRARY = {
    input: { label: 'Input', value: 'R(s)', size: { width: 100, height: 60 } },
    output: { label: 'Output', value: 'C(s)', size: { width: 100, height: 60 } },
    gain: { label: 'Gain', value: 'K', size: { width: 100, height: 60 } },
    integrator: { label: 'Integrator', value: '1/s', size: { width: 100, height: 60 } },
    differentiator: { label: 'Differentiator', value: 's', size: { width: 100, height: 60 } },
    summer: { label: 'Summer', value: '\u03A3', size: { width: 84, height: 84 } },
    takeoff: { label: 'Take Off', value: '', size: { width: 40, height: 54 } }
};

class DiagramEditor {
    constructor(elements) {
        this.el = elements;
        this.state = this.createEmptyState();
        this.history = [];
        this.historyIndex = -1;
        this.dragStartPosition = null;
        this.installEvents();
        this.resetView(false);
        this.pushHistory();
        this.render();
        this.refreshViewport();
        window.addEventListener('resize', () => this.handleViewportResize());
    }

    createEmptyState() {
        return {
            nodes: [],
            edges: [],
            nextNodeId: 1,
            nextEdgeId: 1,
            selectedNodeId: null,
            mode: 'select',
            zoom: 1,
            pan: { x: 0, y: 0 },
            connectFrom: null,
            dragNodeId: null,
            dragPointerOffset: { x: 0, y: 0 },
            previewPoint: null,
            panning: false,
            panPointerStart: { x: 0, y: 0 },
            panStart: { x: 0, y: 0 },
            workspaceMaximized: false
        };
    }

    installEvents() {
        document.querySelectorAll('.block-item').forEach((tool) => {
            tool.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('text/plain', tool.dataset.type);
                event.dataTransfer.effectAllowed = 'copy';
            });
        });

        const searchInput = document.getElementById('blockSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                const term = event.target.value.toLowerCase();
                document.querySelectorAll('.block-item').forEach((item) => {
                    item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
                });
            });
        }

        this.el.workspaceShell.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });

        this.el.workspaceShell.addEventListener('drop', (event) => {
            event.preventDefault();
            const type = event.dataTransfer.getData('text/plain');
            if (!type || !NODE_LIBRARY[type]) return;
            const point = this.screenToWorld(event.clientX, event.clientY);
            this.addNode(type, point.x - 50, point.y - 30);
            this.pushHistory();
            this.setStatus(`${NODE_LIBRARY[type].label} added`);
        });

        this.el.workspaceShell.addEventListener('mousemove', (event) => {
            const point = this.screenToWorld(event.clientX, event.clientY);
            this.el.coordinates.textContent = `X: ${Math.round(point.x)}, Y: ${Math.round(point.y)}`;
            this.handlePointerMove(event, point);
        });

        this.el.workspaceShell.addEventListener('mousedown', (event) => this.handleWorkspaceMouseDown(event));
        window.addEventListener('mousemove', (event) => this.handlePointerMove(event, this.screenToWorld(event.clientX, event.clientY)));
        window.addEventListener('mouseup', () => this.handlePointerUp());

        this.el.zoomInBtn.addEventListener('click', () => this.setZoom(this.state.zoom + 0.1));
        this.el.zoomOutBtn.addEventListener('click', () => this.setZoom(this.state.zoom - 0.1));
        this.el.zoomResetBtn.addEventListener('click', () => this.resetView());
        this.el.selectBtn.addEventListener('click', () => this.setMode('select'));
        this.el.panBtn.addEventListener('click', () => this.setMode('pan'));
        this.el.clearBtn.addEventListener('click', () => this.clear());
        this.el.workspaceToggleBtn.addEventListener('click', () => this.toggleWorkspace());
        this.el.undoBtn.addEventListener('click', () => this.undo());
        this.el.redoBtn.addEventListener('click', () => this.redo());
        this.el.saveBtn.addEventListener('click', () => this.saveToLocal());
        this.el.loadBtn.addEventListener('click', () => this.loadFromLocal());
        this.el.exportBtn.addEventListener('click', () => this.exportSvg());
        this.el.reduceBtn.addEventListener('click', () => this.solveGraph());

        this.el.workspaceShell.addEventListener('wheel', (event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            this.setZoom(this.state.zoom + delta, { clientX: event.clientX, clientY: event.clientY });
        }, { passive: false });

        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                this.undo();
            }
            if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
                event.preventDefault();
                this.redo();
            }
            if (event.key === ' ') {
                event.preventDefault();
                this.setMode('pan');
            }
            if (event.key === 'Escape') {
                console.log("clicked")
                this.state.connectFrom = null;
                this.state.previewPoint = null;
                this.setMode('select');
                this.renderConnections();
            }
        });
    }

    seedExample() {
        this.state = this.createEmptyState();
        const reference = this.addNode('input', 90, 160, false);
        const summer = this.addNode('summer', 270, 148, false);
        const controller = this.addNode('gain', 455, 160, false);
        const system = this.addNode('gain', 645, 160, false);
        const outputTakeoff = this.addNode('takeoff', 840, 163, false);
        const output = this.addNode('output', 985, 160, false);
        const sensor = this.addNode('gain', 645, 395, false);

        reference.data.label = 'Reference';
        reference.data.value = 'R(s)';
        controller.data.label = 'Controller';
        controller.data.value = 'Gc(s)';
        system.data.label = 'System';
        system.data.value = 'G(s)';
        output.data.label = 'Output';
        output.data.value = 'C(s)';
        sensor.data.label = 'Sensor';
        sensor.data.value = 'H(s)';

        this.addEdge(reference.id, 'right', summer.id, 'left', false);
        this.addEdge(summer.id, 'right', controller.id, 'left', false);
        this.addEdge(controller.id, 'right', system.id, 'left', false);
        this.addEdge(system.id, 'right', outputTakeoff.id, 'left', false);
        this.addEdge(outputTakeoff.id, 'right', output.id, 'left', false);
        this.addEdge(outputTakeoff.id, 'bottom', sensor.id, 'top', false);
        this.addEdge(sensor.id, 'right', summer.id, 'bottom', false);
        this.resetView(false);
    }

    cloneState() {
        return JSON.parse(JSON.stringify({
            nodes: this.state.nodes,
            edges: this.state.edges,
            nextNodeId: this.state.nextNodeId,
            nextEdgeId: this.state.nextEdgeId,
            zoom: this.state.zoom,
            pan: this.state.pan,
            workspaceMaximized: this.state.workspaceMaximized
        }));
    }

    applySnapshot(snapshot) {
        const base = this.createEmptyState();
        this.state = { ...base, ...JSON.parse(JSON.stringify(snapshot)) };
        this.state.nodes.forEach((node) => this.rebuildPorts(node));
        this.render();
        this.refreshViewport();
    }

    pushHistory() {
        const snapshot = this.cloneState();
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(snapshot);
        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        } else {
            this.historyIndex += 1;
        }
        this.updateUndoRedoButtons();
    }

    undo() {
        if (this.historyIndex <= 0) return;
        this.historyIndex -= 1;
        this.applySnapshot(this.history[this.historyIndex]);
        this.updateUndoRedoButtons();
        this.setStatus('Undo applied');
    }

    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        this.historyIndex += 1;
        this.applySnapshot(this.history[this.historyIndex]);
        this.updateUndoRedoButtons();
        this.setStatus('Redo applied');
    }

    updateUndoRedoButtons() {
        this.el.undoBtn.disabled = this.historyIndex <= 0;
        this.el.redoBtn.disabled = this.historyIndex >= this.history.length - 1;
    }

    addNode(type, x, y, render = true) {
        const template = NODE_LIBRARY[type];
        const node = {
            id: `node-${this.state.nextNodeId++}`,
            type,
            position: { x, y },
            size: { ...template.size },
            data: this.createNodeData(type),
            ports: []
        };
        this.rebuildPorts(node);
        this.state.nodes.push(node);
        if (render) this.render();
        return node;
    }

    createNodeData(type) {
        if (type === 'summer') {
            return { label: NODE_LIBRARY[type].label, value: '\u03A3', inputSigns: { left: '+', top: '+', bottom: '-' } };
        }
        if (type === 'takeoff') {
            return { label: NODE_LIBRARY[type].label, value: '' };
        }
        return { label: NODE_LIBRARY[type].label, value: NODE_LIBRARY[type].value };
    }

    rebuildPorts(node) {
        const port = (id, side, direction, sign) => {
            const positions = {
                top: { x: node.size.width / 2, y: 0 },
                right: { x: node.size.width, y: node.size.height / 2 },
                bottom: { x: node.size.width / 2, y: node.size.height },
                left: { x: 0, y: node.size.height / 2 }
            };
            return { id, side, direction, sign, ...positions[side] };
        };

        if (node.type === 'summer') {
            const signs = Array.isArray(node.data.inputSigns)
                ? { left: node.data.inputSigns[0] || '+', top: node.data.inputSigns[1] || '+', bottom: node.data.inputSigns[2] || '-' }
                : node.data.inputSigns || {};
            node.data.inputSigns = signs;
            node.ports = [
                port('top', 'top', 'input', signs.top || '+'),
                port('right', 'right', 'output'),
                port('bottom', 'bottom', 'input', signs.bottom || '-'),
                port('left', 'left', 'input', signs.left || '+')
            ];
            return;
        }
        if (node.type === 'takeoff') {
            node.ports = [
                port('top', 'top', 'output'),
                port('right', 'right', 'output'),
                port('bottom', 'bottom', 'output'),
                port('left', 'left', 'input')
            ];
            return;
        }
        if (node.type === 'input') {
            node.ports = [
                port('top', 'top', 'output'),
                port('right', 'right', 'output'),
                port('bottom', 'bottom', 'output'),
                port('left', 'left', 'input')
            ];
            return;
        }
        if (node.type === 'output') {
            node.ports = [
                port('top', 'top', 'input'),
                port('right', 'right', 'output'),
                port('bottom', 'bottom', 'output'),
                port('left', 'left', 'input')
            ];
            return;
        }
        node.ports = [
            port('top', 'top', 'input'),
            port('right', 'right', 'both'),
            port('bottom', 'bottom', 'output'),
            port('left', 'left', 'both')
        ];
    }

    getNode(nodeId) {
        return this.state.nodes.find((node) => node.id === nodeId) || null;
    }

    getPort(node, portId) {
        if (!node) return null;
        const aliases = {
            in: 'left',
            out: 'right',
            in1: 'left',
            in2: 'top',
            in3: 'bottom',
            out1: 'right',
            out2: 'bottom',
            out3: 'top'
        };
        return node.ports.find((port) => port.id === portId || port.id === aliases[portId]) || null;
    }

    getPortAnchor(nodeId, portId) {
        const node = this.getNode(nodeId);
        const port = this.getPort(node, portId);
        return { x: node.position.x + port.x, y: node.position.y + port.y, side: port.side };
    }

    getEdgeEndpoints(edge) {
        return {
            source: this.getPortAnchor(edge.sourceNode, edge.sourcePort),
            target: this.getPortAnchor(edge.targetNode, edge.targetPort)
        };
    }

    canConnect(sourceNodeId, sourcePortId, targetNodeId, targetPortId) {
        if (sourceNodeId === targetNodeId) return false;
        const sourceNode = this.getNode(sourceNodeId);
        const targetNode = this.getNode(targetNodeId);
        const sourcePort = this.getPort(sourceNode, sourcePortId);
        const targetPort = this.getPort(targetNode, targetPortId);
        if (!sourceNode || !targetNode || !sourcePort || !targetPort) return false;
        if (!this.canPortStartConnection(sourcePort) || !this.canPortReceiveConnection(targetPort)) {
            this.setStatus('Connect from an output-capable port to an input-capable port');
            return false;
        }
        if (this.state.edges.some((edge) => edge.sourceNode === sourceNodeId && edge.sourcePort === sourcePortId && edge.targetNode === targetNodeId && edge.targetPort === targetPortId)) {
            this.setStatus('That connection already exists');
            return false;
        }
        if (this.state.edges.some((edge) => edge.targetNode === targetNodeId && edge.targetPort === targetPortId)) {
            this.setStatus('That input is already occupied');
            return false;
        }
        if (targetNode.type === 'takeoff' && this.state.edges.some((edge) => edge.targetNode === targetNodeId)) {
            this.setStatus('Takeoff nodes allow only one incoming edge');
            return false;
        }
        return true;
    }

    canPortStartConnection(port) {
        return port && (port.direction === 'output' || port.direction === 'both');
    }

    canPortReceiveConnection(port) {
        return port && (port.direction === 'input' || port.direction === 'both');
    }

    addEdge(sourceNode, sourcePort, targetNode, targetPort, render = true) {
        if (!this.canConnect(sourceNode, sourcePort, targetNode, targetPort)) return null;
        const edge = { id: `edge-${this.state.nextEdgeId++}`, sourceNode, sourcePort, targetNode, targetPort };
        this.state.edges.push(edge);
        if (render) this.render();
        return edge;
    }

    removeNode(nodeId, render = true) {
        this.state.edges = this.state.edges.filter((edge) => edge.sourceNode !== nodeId && edge.targetNode !== nodeId);
        this.state.nodes = this.state.nodes.filter((node) => node.id !== nodeId);
        if (render) this.render();
    }

    screenToWorld(clientX, clientY) {
        const rect = this.el.workspaceShell.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.state.pan.x) / this.state.zoom,
            y: (clientY - rect.top - this.state.pan.y) / this.state.zoom
        };
    }

    setZoom(nextZoom, pointer) {
        const zoom = Math.max(0.3, Math.min(2.5, nextZoom));
        if (pointer) {
            const rect = this.el.workspaceShell.getBoundingClientRect();
            const worldX = (pointer.clientX - rect.left - this.state.pan.x) / this.state.zoom;
            const worldY = (pointer.clientY - rect.top - this.state.pan.y) / this.state.zoom;
            this.state.zoom = zoom;
            this.state.pan.x = pointer.clientX - rect.left - worldX * zoom;
            this.state.pan.y = pointer.clientY - rect.top - worldY * zoom;
        } else {
            this.state.zoom = zoom;
        }
        this.refreshViewport();
        this.renderConnections();
    }

    resetView(render = true) {
        this.state.zoom = 1;
        this.state.pan = { x: 80, y: 60 };
        this.refreshViewport();
        if (render) this.renderConnections();
    }

    setMode(mode) {
        this.state.mode = mode;
        this.el.modeLabel.textContent = mode === 'pan' ? 'Pan' : 'Select';
        this.el.selectBtn.classList.toggle('active', mode === 'select');
        this.el.panBtn.classList.toggle('active', mode === 'pan');
        this.el.viewport.classList.toggle('panning', mode === 'pan');
    }

    toggleWorkspace() {
        this.state.workspaceMaximized = !this.state.workspaceMaximized;
        this.el.app.classList.toggle('workspace-maximized', this.state.workspaceMaximized);
        this.el.workspaceToggleBtn.textContent = this.state.workspaceMaximized ? 'Restore Workspace' : 'Maximize Workspace';
        this.handleViewportResize();
    }

    handleViewportResize() {
        this.refreshViewport();
        this.renderConnections();
    }

    refreshViewport() {
        this.el.viewport.style.transform = `translate(${this.state.pan.x}px, ${this.state.pan.y}px) scale(${this.state.zoom})`;
        this.el.zoomLabel.textContent = `${Math.round(this.state.zoom * 100)}%`;
    }

    handleWorkspaceMouseDown(event) {
        if (event.button === 1 || this.state.mode === 'pan') {
            this.state.panning = true;
            this.state.panPointerStart = { x: event.clientX, y: event.clientY };
            this.state.panStart = { ...this.state.pan };
            this.el.viewport.classList.add('dragging');
            return;
        }
        if (event.target === this.el.workspaceShell || event.target === this.el.viewport || event.target === this.el.scene) {
            this.state.selectedNodeId = null;
            this.state.connectFrom = null;
            this.state.previewPoint = null;
            this.render();
        }
    }

    handlePointerMove(event, point) {
        if (this.state.dragNodeId) {
            const node = this.getNode(this.state.dragNodeId);
            node.position.x = point.x - this.state.dragPointerOffset.x;
            node.position.y = point.y - this.state.dragPointerOffset.y;
            this.renderNodes();
            this.renderConnections();
            this.renderProperties();
            return;
        }
        if (this.state.panning) {
            this.state.pan.x = this.state.panStart.x + (event.clientX - this.state.panPointerStart.x);
            this.state.pan.y = this.state.panStart.y + (event.clientY - this.state.panPointerStart.y);
            this.refreshViewport();
            this.renderConnections();
            return;
        }
        if (this.state.connectFrom) {
            this.state.previewPoint = point;
            this.renderConnections();
        }
    }

    handlePointerUp() {
        if (this.state.dragNodeId) {
            const node = this.getNode(this.state.dragNodeId);
            if (this.dragStartPosition && (node.position.x !== this.dragStartPosition.x || node.position.y !== this.dragStartPosition.y)) {
                this.pushHistory();
            }
        }
        this.state.dragNodeId = null;
        this.dragStartPosition = null;
        if (this.state.panning) {
            this.state.panning = false;
            this.el.viewport.classList.remove('dragging');
        }
    }

    startNodeDrag(nodeId, event) {
        if (this.state.mode !== 'select') return;
        const node = this.getNode(nodeId);
        const point = this.screenToWorld(event.clientX, event.clientY);
        this.state.dragNodeId = nodeId;
        this.state.dragPointerOffset = { x: point.x - node.position.x, y: point.y - node.position.y };
        this.dragStartPosition = { ...node.position };
    }

    selectNode(nodeId) {
        this.state.selectedNodeId = nodeId;
        this.render();
    }

    handlePortClick(nodeId, portId) {
        const node = this.getNode(nodeId);
        const port = this.getPort(node, portId);
        if (this.state.mode !== 'select') return;
        if (!this.state.connectFrom) {
            if (!this.canPortStartConnection(port)) {
                this.setStatus('Start from an output-capable port');
                return;
            }
            this.state.connectFrom = { nodeId, portId };
            this.state.previewPoint = this.getPortAnchor(nodeId, portId);
            this.setStatus('Connection started');
            this.renderConnections();
            return;
        }
        const start = this.state.connectFrom;
        this.state.connectFrom = null;
        this.state.previewPoint = null;
        if (!this.canPortReceiveConnection(port)) {
            this.setStatus('Finish on an input-capable port');
            this.renderConnections();
            return;
        }
        if (this.addEdge(start.nodeId, start.portId, nodeId, portId, false)) {
            this.pushHistory();
            this.setStatus('Connection created');
        }
        this.render();
    }

    splitEdge(edgeId) {
        const edge = this.state.edges.find((item) => item.id === edgeId);
        if (!edge) return;
        const start = this.getPortAnchor(edge.sourceNode, edge.sourcePort);
        const end = this.getPortAnchor(edge.targetNode, edge.targetPort);
        const takeoff = this.addNode('takeoff', ((start.x + end.x) / 2) - 20, ((start.y + end.y) / 2) - 27, false);
        this.state.edges = this.state.edges.filter((item) => item.id !== edgeId);
        this.addEdge(edge.sourceNode, edge.sourcePort, takeoff.id, 'in', false);
        this.addEdge(takeoff.id, 'out1', edge.targetNode, edge.targetPort, false);
        this.state.selectedNodeId = takeoff.id;
        this.pushHistory();
        this.setStatus('Takeoff inserted');
        this.render();
    }

    updateNodeValue(nodeId, value) {
        const node = this.getNode(nodeId);
        if (!node || node.type === 'summer' || node.type === 'takeoff') return;
        node.data.value = value;
        this.pushHistory();
        this.render();
    }

    updateNodePosition(nodeId, axis, value) {
        const node = this.getNode(nodeId);
        if (!node) return;
        node.position[axis] = Number(value) || 0;
        this.pushHistory();
        this.render();
    }

    updateSummerSign(nodeId, portId, sign) {
        const node = this.getNode(nodeId);
        node.data.inputSigns[portId] = sign;
        this.rebuildPorts(node);
        this.pushHistory();
        this.render();
    }

    clear() {
        this.state = this.createEmptyState();
        this.resetView(false);
        this.pushHistory();
        this.render();
        this.setStatus('Workspace cleared');
    }

    saveToLocal() {
        const rawData = {
            nodes: this.state.nodes.map(n => ({
                id: n.id,
                label: n.data.label,
                type: n.type,
                tfValue: n.data.value,
                x: n.position.x,
                y: n.position.y
            })),
            edges: this.state.edges.map(e => ({
                id: e.id,
                from: e.sourceNode,
                to: e.targetNode
            }))
        };
        console.log(rawData)

        let validatedData;
        try {
            validatedData = GraphSchema.parse(rawData);
        } catch (error) {
            console.error("Output schema validation failed:", error);
            this.setStatus('Export failed: Schema error');
            return;
        }

        const blob = new Blob([JSON.stringify(validatedData, null, 2)], {
            type: "application/json"
        });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "data.json";
        a.click();
        console.log("Saved Data:", validatedData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cloneState()));
        this.setStatus('Saved locally');
    }

    // ─── Backend solve helpers ───────────────────────────────────

    mapNodeType(editorType) {
        const map = { input:'source', output:'sink', gain:'gain', integrator:'gain', differentiator:'gain', summer:'summer', takeoff:'dot' };
        return map[editorType] || editorType;
    }

    mapTfValue(editorType, userValue) {
        if (['input','output','summer','takeoff'].includes(editorType)) return '1;1';
        const v = (userValue || '').trim();
        if (editorType === 'integrator' || v === '1/s') return '1;1 0';
        if (editorType === 'differentiator' || v === 's') return '1 0;1';
        const num = Number(v);
        if (!isNaN(num) && v !== '') return `${num};1`;
        if (v.includes(';')) return v;
        return '2;1';
    }

    isFeedbackEdge(edge) {
        const src = this.getNode(edge.sourceNode);
        const tgt = this.getNode(edge.targetNode);
        if (!src || !tgt) return false;
        if (tgt.type !== 'summer') return false;
        return src.position.x >= tgt.position.x;
    }

    buildBackendPayload() {
        const idMap = {};
        let cloneCount = 0;
        this.state.nodes.forEach((n) => {
            if (n.type !== 'takeoff') return;
            const fbOuts = this.state.edges.filter(
                (e) => e.sourceNode === n.id && this.isFeedbackEdge(e)
            );
            if (fbOuts.length > 1) cloneCount += fbOuts.length - 1;
        });
        const totalNodes = this.state.nodes.length + cloneCount;
        const idPadLen = Math.max(2, String(totalNodes).length);
        const formatNodeId = (seq) => `n${String(seq).padStart(idPadLen, '0')}`;

        let nodeSeq = 0;
        this.state.nodes.forEach((n) => {
            idMap[n.id] = formatNodeId(++nodeSeq);
        });

        let gainCounter = 1;
        const usedLabels = new Set();

        const nodes = this.state.nodes.map(n => {
            const backendType = this.mapNodeType(n.type);
            let baseLabel = '';
            if (backendType === 'gain') {
                let candidate = `K${gainCounter++}`;
                while (usedLabels.has(candidate)) candidate = `K${gainCounter++}`;
                usedLabels.add(candidate);
                baseLabel = candidate;
            } else if (backendType === 'source') {
                baseLabel = 'R(s)';
            } else if (backendType === 'sink') {
                baseLabel = 'C(s)';
            }
            return {
                id: idMap[n.id],
                type: backendType,
                x: Math.round(n.position.x),
                y: Math.round(n.position.y),
                baseLabel,
                tfValue: this.mapTfValue(n.type, n.data.value),
                latex_exp: baseLabel || undefined
            };
        });

        // Dedicated dot per feedback loop
        const dotFbMap = new Map();
        this.state.nodes.forEach(n => {
            if (n.type !== 'takeoff') return;
            const fbOuts = this.state.edges.filter(e =>
                e.sourceNode === n.id && this.isFeedbackEdge(e)
            );
            if (fbOuts.length > 1) dotFbMap.set(n.id, fbOuts);
        });
        const edgeIdRemaps = new Map();
        dotFbMap.forEach((fbEdges, dotId) => {
            for (let i = 1; i < fbEdges.length; i++) {
                const cloneId = formatNodeId(++nodeSeq);
                const orig = nodes.find(nd => nd.id === idMap[dotId]);
                if (!orig) continue;
                nodes.push({ id: cloneId, type:'dot', x: Math.round(orig.x), y: Math.round(orig.y + i*10), baseLabel:'', tfValue:'1;1' });
                edgeIdRemaps.set(fbEdges[i].id, cloneId);
            }
        });

        let edgeCounter = 1;
        const edges = this.state.edges.map(e => {
            let fromId = idMap[e.sourceNode];
            if (edgeIdRemaps.has(e.id)) fromId = edgeIdRemaps.get(e.id);
            return {
                id: `e${edgeCounter++}`,
                from: fromId,
                to: idMap[e.targetNode],
                tf: this.isFeedbackEdge(e) ? '-1;1' : '1;1'
            };
        });
        dotFbMap.forEach((fbEdges, dotId) => {
            for (let i = 1; i < fbEdges.length; i++) {
                const cloneId = edgeIdRemaps.get(fbEdges[i].id);
                if (cloneId) edges.push({ id:`e${edgeCounter++}`, from: idMap[dotId], to: cloneId, tf:'1;1' });
            }
        });

        return { nodes, edges, remake: false };
    }

    validatePayload(payload) {
        const errors = [];

        const nodeMap = new Map(payload.nodes.map(n => [n.id, n]));
        const backwardIntoSummer = (e) => {
            const src = nodeMap.get(e.from);
            const tgt = nodeMap.get(e.to);
            return Boolean(src && tgt && tgt.type === 'summer' && src.x >= tgt.x);
        };

        // Rule 2: IDs n + at least two zero-padded digits (n01, …)
        const idRe = /^n\d{2,}$/;
        payload.nodes.forEach(n => {
            if (!idRe.test(n.id)) errors.push(`Node "${n.id}": invalid ID (must be "n" + two or more digits, e.g. n01)`);
        });

        // Rule 10: Whole-integer coordinates
        payload.nodes.forEach(n => {
            if (!Number.isInteger(n.x) || !Number.isInteger(n.y))
                errors.push(`Node "${n.id}": coordinates must be integers (x=${n.x}, y=${n.y})`);
        });

        // Rule 1: Source / sink canonical baseLabel
        payload.nodes.filter(n => n.type === 'source').forEach(n => {
            if (n.baseLabel !== 'R(s)') errors.push(`Source "${n.id}" must use baseLabel "R(s)" (got "${n.baseLabel ?? ''}")`);
        });
        payload.nodes.filter(n => n.type === 'sink').forEach(n => {
            if (n.baseLabel !== 'C(s)') errors.push(`Sink "${n.id}" must use baseLabel "C(s)" (got "${n.baseLabel ?? ''}")`);
        });

        // Rule 6: Unique gain baseLabel
        const seen = new Set();
        payload.nodes.filter(n => n.type === 'gain').forEach(n => {
            if (!n.baseLabel) errors.push(`Gain "${n.id}" is missing a baseLabel`);
            if (seen.has(n.baseLabel)) errors.push(`Duplicate gain baseLabel "${n.baseLabel}"`);
            seen.add(n.baseLabel);
        });

        // Rule 7: Gains never use tfValue "1;1"
        payload.nodes.filter(n => n.type === 'gain').forEach(n => {
            if (n.tfValue === '1;1') errors.push(`Gain "${n.id}" must not use tfValue "1;1" (use e.g. "2;1" or "1;1 0" for integrator)`);
        });

        const outEdges = new Map();
        payload.nodes.forEach(n => outEdges.set(n.id, []));
        payload.edges.forEach(e => {
            if (outEdges.has(e.from)) outEdges.get(e.from).push(e);
        });

        // Rule 3: Dots branch — ≥2 outgoing, plus ≥1 forward and ≥1 feedback
        payload.nodes.filter(n => n.type === 'dot').forEach(dot => {
            const outgoing = outEdges.get(dot.id) || [];
            if (outgoing.length < 2) errors.push(`Dot "${dot.id}" must have at least 2 outgoing edges (has ${outgoing.length})`);
            let hasFeedback = false;
            let hasForward = false;
            outgoing.forEach(e => {
                if (backwardIntoSummer(e)) hasFeedback = true;
                else hasForward = true;
            });
            if (outgoing.length >= 2 && (!hasFeedback || !hasForward)) {
                errors.push(`Dot "${dot.id}" must have at least one forward branch and one feedback branch into a summer`);
            }
        });

        // Rule 4: Summer needs ≥2 incoming edges
        const inCount = new Map();
        payload.nodes.forEach(n => inCount.set(n.id, 0));
        payload.edges.forEach(e => { if (inCount.has(e.to)) inCount.set(e.to, inCount.get(e.to) + 1); });
        payload.nodes.filter(n => n.type === 'summer').forEach(n => {
            const c = inCount.get(n.id) || 0;
            if (c < 2) errors.push(`Summer "${n.id}" must have at least 2 incoming edges (has ${c})`);
        });

        // Rule 8: One feedback path per dot (into summer backward)
        const dotFbOutCount = new Map();
        payload.edges.forEach(e => {
            const src = nodeMap.get(e.from);
            const tgt = nodeMap.get(e.to);
            if (src && tgt && src.type === 'dot' && tgt.type === 'summer' && src.x >= tgt.x) {
                dotFbOutCount.set(e.from, (dotFbOutCount.get(e.from) || 0) + 1);
            }
        });
        dotFbOutCount.forEach((count, dotId) => {
            if (count > 1) errors.push(`Dot "${dotId}" feeds ${count} feedback loops — each loop needs its own dot`);
        });

        // Rule 5: tf — backward into summer "-1;1", otherwise "1;1"
        payload.edges.forEach(e => {
            const want = backwardIntoSummer(e) ? '-1;1' : '1;1';
            if (e.tf !== want) errors.push(`Edge "${e.id}" (${e.from}→${e.to}) must have tf "${want}", got "${e.tf ?? ''}"`);
        });

        // Rule 9: No dead-end except sink
        const outCount = new Map();
        payload.nodes.forEach(n => outCount.set(n.id, 0));
        payload.edges.forEach(e => { if (outCount.has(e.from)) outCount.set(e.from, outCount.get(e.from) + 1); });
        payload.nodes.forEach(n => {
            if (n.type !== 'sink' && (outCount.get(n.id) || 0) === 0)
                errors.push(`Dead-end: "${n.id}" (${n.type}) has no outgoing edges`);
        });

        return errors;
    }

    async solveGraph() {
        const payload = this.buildBackendPayload();
        const errors = this.validatePayload(payload);
        if (errors.length > 0) {
            console.error('Validation failed:', errors);
            this.setStatus(`Solve blocked: ${errors[0]}`);
            alert('Cannot solve — fix these issues:\n\n• ' + errors.join('\n• '));
            return;
        }

        this.el.reduceBtn.disabled = true;
        this.el.reduceBtn.textContent = 'Solving…';
        this.setStatus('Sending diagram to solver…');

        try {
            console.log(payload)
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);

            const result = await res.json();
            let validated;
            console.log(result)
            // try { validated = FinalSchema.parse(result); }
            // catch { validated = result; }

            console.log('Solver response:', validated);
            this.setStatus('Reduction complete ✓');
            this.lastSolverResult = validated;

            if (result && result.redirect_url) {
                window.location.href = result.redirect_url;
            } else if (validated && validated.redirect_url) {
                window.location.href = validated.redirect_url;
            }
        } catch (err) {
            console.error('Solve failed:', err);
            this.setStatus(`Solve failed: ${err.message}`);
            alert(`Solver error:\n${err.message}`);
        } finally {
            this.el.reduceBtn.disabled = false;
            this.el.reduceBtn.textContent = 'Reduce Graph';
        }
    }

    loadFromLocal() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            this.setStatus('No saved diagram found');
            return;
        }
        this.applySnapshot(JSON.parse(raw));
        this.pushHistory();
        this.setStatus('Loaded local diagram');
    }

    exportSvg() {
        const serializer = new XMLSerializer();
        const svgText = serializer.serializeToString(this.el.connectionLayer);
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'connections.svg';
        link.click();
        URL.revokeObjectURL(url);
        this.setStatus('SVG exported');
    }

    getPortVector(side = 'right') {
        const vectors = {
            top: { x: 0, y: -1 },
            right: { x: 1, y: 0 },
            bottom: { x: 0, y: 1 },
            left: { x: -1, y: 0 }
        };
        return vectors[side] || vectors.right;
    }

    getNodeBounds(nodeId, padding = 0) {
        const node = this.getNode(nodeId);
        return {
            left: node.position.x - padding,
            right: node.position.x + node.size.width + padding,
            top: node.position.y - padding,
            bottom: node.position.y + node.size.height + padding
        };
    }

    getClearLoopLaneY(start, end, edge) {
        const minX = Math.min(start.x, end.x) - ROUTE.nodePadding;
        const maxX = Math.max(start.x, end.x) + ROUTE.nodePadding;
        const relatedNodeIds = new Set([edge.sourceNode, edge.targetNode]);
        const nodeBottoms = this.state.nodes
            .filter((node) => {
                const bounds = {
                    left: node.position.x - ROUTE.nodePadding,
                    right: node.position.x + node.size.width + ROUTE.nodePadding
                };
                return relatedNodeIds.has(node.id) || (bounds.right >= minX && bounds.left <= maxX);
            })
            .map((node) => node.position.y + node.size.height + ROUTE.nodePadding);
        return Math.max(start.y, end.y, ...nodeBottoms) + ROUTE.loopDrop;
    }

    offsetPoint(point, side, distance) {
        const vector = this.getPortVector(side);
        return {
            x: point.x + vector.x * distance,
            y: point.y + vector.y * distance,
            side: point.side
        };
    }

    pointsToPath(points) {
        const cleaned = points.filter((point, index) => {
            if (index === 0) return true;
            const previous = points[index - 1];
            return previous.x !== point.x || previous.y !== point.y;
        });
        return cleaned.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    }

    buildOrthogonalPath(start, end, edge = null) {
        const sourceSide = start.side || 'right';
        const targetSide = end.side || 'left';

        const startStub = this.offsetPoint(start, sourceSide, ROUTE.stub);
        const endStub = this.offsetPoint(end, targetSide, ROUTE.stub);

        const dx = Math.abs(startStub.x - endStub.x);
        const dy = Math.abs(startStub.y - endStub.y);

        const STRAIGHT_THRESHOLD = 10; // 🔥 adjust this value

        // ✅ NEW: snap to straight line if bend is very small
        if (dx < STRAIGHT_THRESHOLD || dy < STRAIGHT_THRESHOLD) {
            return this.pointsToPath([
                start,
                startStub,
                endStub,
                end
            ]);
        }

        const isBackward =
            start.x > end.x ||
            (sourceSide === 'right' && targetSide !== 'left' && end.x < start.x + ROUTE.stub);

        if (isBackward && edge) {
            const laneY = this.getClearLoopLaneY(start, end, edge);
            const returnX =
                targetSide === 'bottom' || targetSide === 'top'
                    ? end.x
                    : endStub.x;

            return this.pointsToPath([
                start,
                startStub,
                { x: startStub.x, y: laneY },
                { x: returnX, y: laneY },
                endStub,
                end
            ]);
        }

        if (sourceSide === 'bottom' && targetSide === 'top') {
            const laneY = Math.max(startStub.y, endStub.y);
            return this.pointsToPath([
                start,
                startStub,
                { x: endStub.x, y: laneY },
                endStub,
                end
            ]);
        }

        if (sourceSide === 'top' && targetSide === 'bottom') {
            const laneY = Math.min(startStub.y, endStub.y);
            return this.pointsToPath([
                start,
                startStub,
                { x: endStub.x, y: laneY },
                endStub,
                end
            ]);
        }

        const verticalFirst = sourceSide === 'top' || sourceSide === 'bottom';

        const mid = verticalFirst
            ? { x: startStub.x, y: endStub.y }
            : { x: endStub.x, y: startStub.y };

        // existing close-distance reroute
        if (
            dx < ROUTE.minLaneGap &&
            dy < ROUTE.minLaneGap
        ) {
            const laneX = Math.max(startStub.x, endStub.x) + ROUTE.minLaneGap;
            return this.pointsToPath([
                start,
                startStub,
                { x: laneX, y: startStub.y },
                { x: laneX, y: endStub.y },
                endStub,
                end
            ]);
        }

        return this.pointsToPath([
            start,
            startStub,
            mid,
            endStub,
            end
        ]);
    }

    render() {
        this.renderNodes();
        this.renderConnections();
        this.renderProperties();
        this.renderCounters();
    }

    renderNodes() {
        this.el.blocksContainer.innerHTML = '';
        this.state.nodes.forEach((node) => {
            const block = document.createElement('div');
            block.className = `block ${node.type}`;
            if (this.state.selectedNodeId === node.id) block.classList.add('selected');
            block.style.left = `${node.position.x}px`;
            block.style.top = `${node.position.y}px`;
            block.style.width = `${node.size.width}px`;
            block.style.height = `${node.size.height}px`;

            const content = document.createElement('div');
            content.className = 'block-content';
            content.addEventListener('mousedown', (event) => {
                event.stopPropagation();
                this.selectNode(node.id);
                this.startNodeDrag(node.id, event);
            });

            if (node.type === 'summer') {
                const sigma = document.createElement('div');
                sigma.className = 'summer-symbol';
                sigma.textContent = '\u03A3';
                content.appendChild(sigma);
            } else if (node.type !== 'takeoff') {
                content.innerHTML = `<div class="block-label">${node.data.label}</div><div class="block-value">${node.data.value}</div>`;
            }
            block.appendChild(content);

            node.ports.forEach((port) => {
                const point = document.createElement('button');
                point.type = 'button';
                point.className = `port ${port.direction}`;
                point.style.left = `${port.x}px`;
                point.style.top = `${port.y}px`;
                point.title = `${node.data.label} ${port.id} ${port.direction}`;
                point.addEventListener('mousedown', (event) => event.stopPropagation());
                point.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.handlePortClick(node.id, port.id);
                });
                block.appendChild(point);

                if (node.type === 'summer' && port.direction === 'input') {
                    const sign = document.createElement('div');
                    sign.className = `port-label ${port.sign === '-' ? 'minus' : ''}`;
                    sign.textContent = port.sign;
                    const labelPositions = {
                        top: { x: port.x + 16, y: port.y - 12 },
                        bottom: { x: port.x + 16, y: port.y + 14 },
                        left: { x: port.x - 22, y: port.y },
                        right: { x: port.x + 18, y: port.y }
                    };
                    const labelPoint = labelPositions[port.side];
                    sign.style.left = `${labelPoint.x}px`;
                    sign.style.top = `${labelPoint.y}px`;
                    block.appendChild(sign);
                }
            });

            this.el.blocksContainer.appendChild(block);
        });
    }

    renderConnections() {
        const svg = this.el.connectionLayer;
        svg.setAttribute('viewBox', `0 0 ${DEFAULT_SCENE.width} ${DEFAULT_SCENE.height}`);
        svg.setAttribute('width', DEFAULT_SCENE.width);
        svg.setAttribute('height', DEFAULT_SCENE.height);
        while (svg.childNodes.length > 1) {
            svg.removeChild(svg.lastChild);
        }
        console.log(this.state.edges)
        this.state.edges.forEach((edge) => {
            const { source, target } = this.getEdgeEndpoints(edge);
            const pathValue = this.buildOrthogonalPath(source, target, edge);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathValue);
            path.setAttribute('class', 'connection-path');
            path.setAttribute('marker-end', 'url(#arrowhead)');
            svg.appendChild(path);

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('d', pathValue);
            hit.setAttribute('class', 'connection-hit');
            hit.addEventListener('click', (event) => {
                event.stopPropagation();
                this.splitEdge(edge.id);
            });
            svg.appendChild(hit);
        });

        if (this.state.connectFrom && this.state.previewPoint) {
            const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            preview.setAttribute('d', this.buildOrthogonalPath(
                this.getPortAnchor(this.state.connectFrom.nodeId, this.state.connectFrom.portId),
                { ...this.state.previewPoint, side: 'left' }
            ));
            preview.setAttribute('class', 'connection-preview');
            svg.appendChild(preview);
        }
    }

    renderProperties() {
        const node = this.getNode(this.state.selectedNodeId);
        if (!node) {
            this.el.propertiesContent.innerHTML = '<p class="placeholder">Select a block to edit properties</p>';
            return;
        }

        let html = `
            <div class="property-group"><label>Type</label><input type="text" value="${node.data.label}" readonly></div>
            <div class="property-group"><label>Position X</label><input id="propX" type="number" value="${Math.round(node.position.x)}"></div>
            <div class="property-group"><label>Position Y</label><input id="propY" type="number" value="${Math.round(node.position.y)}"></div>
        `;

        if (!['summer', 'takeoff'].includes(node.type)) {
            html += `<div class="property-group"><label>Value</label><input id="propValue" type="text" value="${node.data.value}"></div>`;
        }

        if (node.type === 'summer') {
            html += '<div class="property-group"><label>Input Signs</label>';
            node.ports.filter((port) => port.direction === 'input').forEach((port) => {
                const label = `${port.side.charAt(0).toUpperCase()}${port.side.slice(1)} input`;
                html += `
                    <div class="sign-row">
                        <span>${label}</span>
                        <select data-sign-port="${port.id}">
                            <option value="+" ${port.sign === '+' ? 'selected' : ''}>+</option>
                            <option value="-" ${port.sign === '-' ? 'selected' : ''}>-</option>
                        </select>
                    </div>
                `;
            });
            html += '</div>';
        }

        if (node.type === 'takeoff') {
            html += `<div class="property-group"><label>Takeoff Routing</label><input type="text" value="1 input / ${node.ports.filter((port) => port.direction === 'output').length} outputs" readonly></div>`;
        }

        html += '<div class="property-group"><button id="deleteNodeBtn" class="btn btn-secondary" type="button" style="width:100%;">Delete Block</button></div>';
        this.el.propertiesContent.innerHTML = html;

        document.getElementById('propX').addEventListener('change', (event) => this.updateNodePosition(node.id, 'x', event.target.value));
        document.getElementById('propY').addEventListener('change', (event) => this.updateNodePosition(node.id, 'y', event.target.value));
        const valueInput = document.getElementById('propValue');
        if (valueInput) valueInput.addEventListener('change', (event) => this.updateNodeValue(node.id, event.target.value));
        this.el.propertiesContent.querySelectorAll('[data-sign-port]').forEach((select) => {
            select.addEventListener('change', (event) => this.updateSummerSign(node.id, event.target.dataset.signPort, event.target.value));
        });
        document.getElementById('deleteNodeBtn').addEventListener('click', () => {
            this.removeNode(node.id);
            this.state.selectedNodeId = null;
            this.pushHistory();
            this.render();
        });
    }

    renderCounters() {
        this.el.nodeCount.textContent = String(this.state.nodes.length);
        this.el.edgeCount.textContent = String(this.state.edges.length);
        this.el.blockCount.textContent = `Blocks: ${this.state.nodes.length}`;
        this.el.connectionCount.textContent = `Connections: ${this.state.edges.length}`;
    }

    setStatus(message) {
        this.el.statusText.textContent = message;
    }
}

const editor = new DiagramEditor({
    app: document.getElementById('app'),
    workspaceShell: document.getElementById('workspaceShell'),
    viewport: document.getElementById('viewport'),
    scene: document.getElementById('scene'),
    blocksContainer: document.getElementById('blocks-container'),
    connectionLayer: document.getElementById('connectionLayer'),
    propertiesContent: document.getElementById('properties-content'),
    statusText: document.getElementById('status-text'),
    coordinates: document.getElementById('coordinates'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomResetBtn: document.getElementById('zoomResetBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    selectBtn: document.getElementById('selectBtn'),
    panBtn: document.getElementById('panBtn'),
    clearBtn: document.getElementById('clearBtn'),
    workspaceToggleBtn: document.getElementById('workspaceToggleBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    saveBtn: document.getElementById('saveBtn'),
    loadBtn: document.getElementById('loadBtn'),
    exportBtn: document.getElementById('exportBtn'),
    reduceBtn: document.getElementById('reduceBtn'),
    nodeCount: document.getElementById('nodeCount'),
    edgeCount: document.getElementById('edgeCount'),
    modeLabel: document.getElementById('modeLabel'),
    blockCount: document.getElementById('block-count'),
    connectionCount: document.getElementById('connection-count')
});

window.editor = editor;
