const DEFAULT_SCENE = { width: 4000, height: 2400 };

const NODE_LIBRARY = {
    input: { label: 'Input', value: 'R(s)', size: { width: 92, height: 56 } },
    output: { label: 'Output', value: 'C(s)', size: { width: 92, height: 56 } },
    gain: { label: 'Gain', value: 'K', size: { width: 108, height: 64 } },
    integrator: { label: 'Integrator', value: '1/s', size: { width: 108, height: 64 } },
    differentiator: { label: 'Differentiator', value: 's', size: { width: 108, height: 64 } },
    summer: { label: 'Summer', value: 'Σ', size: { width: 86, height: 86 } },
    takeoff: { label: 'Takeoff', value: '', size: { width: 40, height: 54 } }
};

class DiagramEditor {
    constructor(elements) {
        this.el = elements;
        this.state = {
            nodes: [],
            edges: [],
            nextNodeId: 1,
            nextEdgeId: 1,
            selectedNodeId: null,
            selectedEdgeId: null,
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

        this.installEvents();
        this.seedExample();
        this.render();
        this.refreshViewport();
        window.addEventListener('resize', () => this.handleViewportResize());
    }

    installEvents() {
        document.querySelectorAll('.tool-card').forEach((tool) => {
            tool.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('text/plain', tool.dataset.type);
                event.dataTransfer.effectAllowed = 'copy';
            });
        });

        this.el.workspaceShell.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });

        this.el.workspaceShell.addEventListener('drop', (event) => {
            event.preventDefault();
            const type = event.dataTransfer.getData('text/plain');
            if (!type) {
                return;
            }
            const point = this.screenToWorld(event.clientX, event.clientY);
            this.addNode(type, point.x - 40, point.y - 30);
            this.setStatus(`${NODE_LIBRARY[type].label} added`);
        });

        this.el.workspaceShell.addEventListener('mousemove', (event) => {
            const point = this.screenToWorld(event.clientX, event.clientY);
            this.el.pointerPosition.textContent = `X: ${Math.round(point.x)}, Y: ${Math.round(point.y)}`;
            this.handlePointerMove(event, point);
        });

        this.el.workspaceShell.addEventListener('mousedown', (event) => this.handleWorkspaceMouseDown(event));
        window.addEventListener('mousemove', (event) => {
            const point = this.screenToWorld(event.clientX, event.clientY);
            this.handlePointerMove(event, point);
        });
        window.addEventListener('mouseup', () => this.handlePointerUp());

        this.el.zoomInBtn.addEventListener('click', () => this.setZoom(this.state.zoom + 0.1));
        this.el.zoomOutBtn.addEventListener('click', () => this.setZoom(this.state.zoom - 0.1));
        this.el.zoomResetBtn.addEventListener('click', () => this.resetView());
        this.el.selectBtn.addEventListener('click', () => this.setMode('select'));
        this.el.panBtn.addEventListener('click', () => this.setMode('pan'));
        this.el.clearBtn.addEventListener('click', () => this.clear());
        this.el.workspaceToggleBtn.addEventListener('click', () => this.toggleWorkspace());

        this.el.workspaceShell.addEventListener('wheel', (event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            this.setZoom(this.state.zoom + delta, { clientX: event.clientX, clientY: event.clientY });
        }, { passive: false });
    }

    seedExample() {
        const in1 = this.addNode('input', 100, 150, false);
        const in2 = this.addNode('input', 100, 320, false);
        const gain = this.addNode('gain', 270, 140, false);
        const takeoff = this.addNode('takeoff', 450, 140, false);
        const summer = this.addNode('summer', 660, 120, false);
        const differentiator = this.addNode('differentiator', 650, 300, false);
        const out = this.addNode('output', 920, 150, false);

        this.addEdge(gain.id, 'out', takeoff.id, 'in', false);
        this.addEdge(in1.id, 'out', gain.id, 'in', false);
        this.addEdge(takeoff.id, 'out1', summer.id, 'in1', false);
        this.addEdge(takeoff.id, 'out2', differentiator.id, 'in', false);
        this.addEdge(differentiator.id, 'out', summer.id, 'in3', false);
        this.addEdge(in2.id, 'out', summer.id, 'in2', false);
        this.addEdge(summer.id, 'out', out.id, 'in', false);
        this.resetView(false);
    }

    clear() {
        this.state.nodes = [];
        this.state.edges = [];
        this.state.nextNodeId = 1;
        this.state.nextEdgeId = 1;
        this.state.selectedNodeId = null;
        this.state.selectedEdgeId = null;
        this.state.connectFrom = null;
        this.seedExample();
        this.setStatus('Workspace reset to the working example');
        this.render();
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
        if (render) {
            this.render();
        }
        return node;
    }

    createNodeData(type) {
        if (type === 'summer') {
            return {
                label: NODE_LIBRARY[type].label,
                value: 'Σ',
                inputSigns: ['+', '+', '-', '+']
            };
        }

        if (type === 'takeoff') {
            return {
                label: NODE_LIBRARY[type].label,
                value: '',
                outputCount: 3
            };
        }

        return {
            label: NODE_LIBRARY[type].label,
            value: NODE_LIBRARY[type].value
        };
    }

    rebuildPorts(node) {
        if (node.type === 'summer') {
            const signCount = Math.max(4, node.data.inputSigns.length);
            const spacing = node.size.height / (signCount + 1);
            node.ports = [];
            for (let index = 0; index < signCount; index += 1) {
                node.ports.push({
                    id: `in${index + 1}`,
                    direction: 'input',
                    x: 0,
                    y: spacing * (index + 1),
                    sign: node.data.inputSigns[index] || '+'
                });
            }
            node.ports.push({
                id: 'out',
                direction: 'output',
                x: node.size.width,
                y: node.size.height / 2
            });
            return;
        }

        if (node.type === 'takeoff') {
            const outputCount = Math.max(3, node.data.outputCount || 3);
            node.size.height = Math.max(54, outputCount * 18);
            node.ports = [{
                id: 'in',
                direction: 'input',
                x: 0,
                y: node.size.height / 2
            }];
            const spacing = node.size.height / (outputCount + 1);
            for (let index = 0; index < outputCount; index += 1) {
                node.ports.push({
                    id: `out${index + 1}`,
                    direction: 'output',
                    x: node.size.width,
                    y: spacing * (index + 1)
                });
            }
            return;
        }

        if (node.type === 'input') {
            node.ports = [{ id: 'out', direction: 'output', x: node.size.width, y: node.size.height / 2 }];
            return;
        }

        if (node.type === 'output') {
            node.ports = [{ id: 'in', direction: 'input', x: 0, y: node.size.height / 2 }];
            return;
        }

        node.ports = [
            { id: 'in', direction: 'input', x: 0, y: node.size.height / 2 },
            { id: 'out', direction: 'output', x: node.size.width, y: node.size.height / 2 }
        ];
    }

    addEdge(sourceNode, sourcePort, targetNode, targetPort, render = true) {
        if (!this.canConnect(sourceNode, sourcePort, targetNode, targetPort)) {
            return null;
        }

        const edge = {
            id: `edge-${this.state.nextEdgeId++}`,
            sourceNode,
            sourcePort,
            targetNode,
            targetPort
        };

        this.state.edges.push(edge);
        const source = this.getNode(sourceNode);
        if (source && source.type === 'takeoff') {
            this.ensureTakeoffCapacity(source);
        }
        if (render) {
            this.render();
        }
        return edge;
    }

    canConnect(sourceNodeId, sourcePortId, targetNodeId, targetPortId) {
        if (sourceNodeId === targetNodeId) {
            this.setStatus('Self-connections are not allowed for this example');
            return false;
        }

        const sourceNode = this.getNode(sourceNodeId);
        const targetNode = this.getNode(targetNodeId);
        const sourcePort = this.getPort(sourceNode, sourcePortId);
        const targetPort = this.getPort(targetNode, targetPortId);

        if (!sourceNode || !targetNode || !sourcePort || !targetPort) {
            return false;
        }

        if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') {
            this.setStatus('Connections must go from an output port to an input port');
            return false;
        }

        const duplicate = this.state.edges.some((edge) => (
            edge.sourceNode === sourceNodeId &&
            edge.sourcePort === sourcePortId &&
            edge.targetNode === targetNodeId &&
            edge.targetPort === targetPortId
        ));

        if (duplicate) {
            this.setStatus('That connection already exists');
            return false;
        }

        const inputOccupied = this.state.edges.some((edge) => (
            edge.targetNode === targetNodeId && edge.targetPort === targetPortId
        ));

        if (inputOccupied) {
            this.setStatus('That input port already has an incoming edge');
            return false;
        }

        const targetIncoming = this.state.edges.filter((edge) => edge.targetNode === targetNodeId);
        if (targetNode.type === 'takeoff' && targetIncoming.length >= 1) {
            this.setStatus('A takeoff can only have one incoming edge');
            return false;
        }

        return true;
    }

    getNode(nodeId) {
        return this.state.nodes.find((node) => node.id === nodeId) || null;
    }

    getPort(node, portId) {
        if (!node) {
            return null;
        }
        return node.ports.find((port) => port.id === portId) || null;
    }

    getPortAnchor(nodeId, portId) {
        const node = this.getNode(nodeId);
        const port = this.getPort(node, portId);
        return {
            x: node.position.x + port.x,
            y: node.position.y + port.y
        };
    }

    ensureTakeoffCapacity(node) {
        const outgoingCount = this.state.edges.filter((edge) => edge.sourceNode === node.id).length;
        const desired = Math.max(3, outgoingCount + 1);
        if (desired !== node.data.outputCount) {
            node.data.outputCount = desired;
            this.rebuildPorts(node);
        }
    }

    screenToWorld(clientX, clientY) {
        const rect = this.el.workspaceShell.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.state.pan.x) / this.state.zoom,
            y: (clientY - rect.top - this.state.pan.y) / this.state.zoom
        };
    }

    setZoom(nextZoom, pointer) {
        const clamped = Math.max(0.3, Math.min(2.5, nextZoom));
        if (pointer) {
            const rect = this.el.workspaceShell.getBoundingClientRect();
            const worldX = (pointer.clientX - rect.left - this.state.pan.x) / this.state.zoom;
            const worldY = (pointer.clientY - rect.top - this.state.pan.y) / this.state.zoom;
            this.state.zoom = clamped;
            this.state.pan.x = pointer.clientX - rect.left - worldX * clamped;
            this.state.pan.y = pointer.clientY - rect.top - worldY * clamped;
        } else {
            this.state.zoom = clamped;
        }
        this.refreshViewport();
        this.renderConnections();
    }

    resetView(render = true) {
        this.state.zoom = 1;
        this.state.pan = { x: 80, y: 60 };
        this.refreshViewport();
        if (render) {
            this.renderConnections();
        }
    }

    setMode(mode) {
        this.state.mode = mode;
        this.el.modeLabel.textContent = mode === 'pan' ? 'Pan' : 'Select';
        this.el.selectBtn.classList.toggle('is-active', mode === 'select');
        this.el.panBtn.classList.toggle('is-active', mode === 'pan');
        this.el.viewport.classList.toggle('is-panning', mode === 'pan');
        this.setStatus(mode === 'pan' ? 'Pan mode enabled' : 'Select mode enabled');
    }

    toggleWorkspace() {
        this.state.workspaceMaximized = !this.state.workspaceMaximized;
        this.el.app.classList.toggle('workspace-maximized', this.state.workspaceMaximized);
        this.el.workspaceToggleBtn.textContent = this.state.workspaceMaximized ? 'Restore Layout' : 'Maximize Workspace';
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
            this.startPanning(event);
            return;
        }

        if (event.target === this.el.workspaceShell || event.target === this.el.viewport || event.target === this.el.scene) {
            this.state.selectedNodeId = null;
            this.state.selectedEdgeId = null;
            this.renderInspector();
            this.renderConnections();
            this.renderNodes();
        }
    }

    startPanning(event) {
        this.state.panning = true;
        this.state.panPointerStart = { x: event.clientX, y: event.clientY };
        this.state.panStart = { ...this.state.pan };
        this.el.viewport.classList.add('dragging');
    }

    handlePointerMove(event, point) {
        if (this.state.dragNodeId) {
            const node = this.getNode(this.state.dragNodeId);
            node.position.x = point.x - this.state.dragPointerOffset.x;
            node.position.y = point.y - this.state.dragPointerOffset.y;
            this.renderNodes();
            this.renderConnections();
            this.renderInspector();
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
        this.state.dragNodeId = null;
        if (this.state.panning) {
            this.state.panning = false;
            this.el.viewport.classList.remove('dragging');
        }
    }

    startNodeDrag(nodeId, event) {
        if (this.state.mode !== 'select') {
            return;
        }
        const node = this.getNode(nodeId);
        const point = this.screenToWorld(event.clientX, event.clientY);
        this.state.dragNodeId = nodeId;
        this.state.dragPointerOffset = {
            x: point.x - node.position.x,
            y: point.y - node.position.y
        };
    }

    selectNode(nodeId) {
        this.state.selectedNodeId = nodeId;
        this.state.selectedEdgeId = null;
        this.renderNodes();
        this.renderConnections();
        this.renderInspector();
    }

    selectEdge(edgeId) {
        this.state.selectedEdgeId = edgeId;
        this.state.selectedNodeId = null;
        this.renderNodes();
        this.renderConnections();
        this.renderInspector();
    }

    handlePortClick(nodeId, portId) {
        const node = this.getNode(nodeId);
        const port = this.getPort(node, portId);
        if (this.state.mode !== 'select') {
            return;
        }

        if (!this.state.connectFrom) {
            if (port.direction !== 'output') {
                this.setStatus('Start from an output port');
                return;
            }
            this.state.connectFrom = { nodeId, portId };
            this.state.previewPoint = this.getPortAnchor(nodeId, portId);
            this.state.selectedNodeId = nodeId;
            this.setStatus('Connection started. Click an input port to complete it.');
            this.renderNodes();
            this.renderConnections();
            this.renderInspector();
            return;
        }

        const source = this.state.connectFrom;
        this.state.connectFrom = null;
        this.state.previewPoint = null;

        if (port.direction !== 'input') {
            this.setStatus('Finish on an input port');
            this.renderConnections();
            return;
        }

        if (this.addEdge(source.nodeId, source.portId, nodeId, portId, false)) {
            this.setStatus('Connection created');
        }
        this.render();
    }

    handleEdgeSplit(edgeId) {
        const edge = this.state.edges.find((item) => item.id === edgeId);
        if (!edge) {
            return;
        }

        const source = this.getPortAnchor(edge.sourceNode, edge.sourcePort);
        const target = this.getPortAnchor(edge.targetNode, edge.targetPort);
        const midpoint = {
            x: (source.x + target.x) / 2,
            y: (source.y + target.y) / 2
        };

        this.state.edges = this.state.edges.filter((item) => item.id !== edgeId);
        const takeoff = this.addNode('takeoff', midpoint.x - 20, midpoint.y - 27, false);
        this.addEdge(edge.sourceNode, edge.sourcePort, takeoff.id, 'in', false);
        this.addEdge(takeoff.id, 'out1', edge.targetNode, edge.targetPort, false);
        this.state.selectedNodeId = takeoff.id;
        this.state.selectedEdgeId = null;
        this.setStatus('Takeoff inserted into the selected connection');
        this.render();
    }

    updateNodeValue(nodeId, value) {
        const node = this.getNode(nodeId);
        if (!node || node.type === 'summer' || node.type === 'takeoff') {
            return;
        }
        node.data.value = value;
        this.renderNodes();
        this.renderInspector();
        this.setStatus(`${node.data.label} updated`);
    }

    updateNodePosition(nodeId, axis, value) {
        const node = this.getNode(nodeId);
        if (!node) {
            return;
        }
        node.position[axis] = Number(value) || 0;
        this.renderNodes();
        this.renderConnections();
        this.renderInspector();
    }

    updateSummerSign(nodeId, portId, sign) {
        const node = this.getNode(nodeId);
        const index = Number(portId.replace('in', '')) - 1;
        node.data.inputSigns[index] = sign;
        this.rebuildPorts(node);
        this.render();
        this.setStatus(`Summer port ${portId} sign set to ${sign}`);
    }

    render() {
        this.renderNodes();
        this.renderConnections();
        this.renderInspector();
        this.renderCounters();
    }

    renderNodes() {
        this.el.blocksLayer.innerHTML = '';
        this.state.nodes.forEach((node) => {
            const block = document.createElement('div');
            block.className = `block ${node.type}`;
            if (this.state.selectedNodeId === node.id) {
                block.classList.add('selected');
            }
            block.style.left = `${node.position.x}px`;
            block.style.top = `${node.position.y}px`;
            block.style.width = `${node.size.width}px`;
            block.style.height = `${node.size.height}px`;
            block.dataset.nodeId = node.id;

            const body = document.createElement('div');
            body.className = 'block-body';
            body.addEventListener('mousedown', (event) => {
                event.stopPropagation();
                this.selectNode(node.id);
                this.startNodeDrag(node.id, event);
            });

            if (node.type === 'summer') {
                const symbol = document.createElement('div');
                symbol.className = 'summer-symbol';
                symbol.textContent = 'Σ';
                body.appendChild(symbol);
            } else if (node.type !== 'takeoff') {
                body.innerHTML = `
                    <div class="block-title">${node.data.label}</div>
                    <div class="block-value">${node.data.value}</div>
                `;
            }

            block.appendChild(body);

            node.ports.forEach((port) => {
                const portButton = document.createElement('button');
                portButton.type = 'button';
                portButton.className = `port ${port.direction}`;
                portButton.style.left = `${port.x}px`;
                portButton.style.top = `${port.y}px`;
                portButton.title = `${node.data.label} ${port.id}`;
                portButton.addEventListener('mousedown', (event) => event.stopPropagation());
                portButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.handlePortClick(node.id, port.id);
                });
                block.appendChild(portButton);

                if (node.type === 'summer' && port.direction === 'input') {
                    const sign = document.createElement('div');
                    sign.className = `port-label ${port.sign === '-' ? 'minus' : ''}`;
                    sign.textContent = port.sign;
                    sign.style.left = `${port.x - 20}px`;
                    sign.style.top = `${port.y}px`;
                    block.appendChild(sign);
                }
            });

            this.el.blocksLayer.appendChild(block);
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

        this.state.edges.forEach((edge) => {
            const start = this.getPortAnchor(edge.sourceNode, edge.sourcePort);
            const end = this.getPortAnchor(edge.targetNode, edge.targetPort);
            const curve = this.buildBezierPath(start, end);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', curve);
            path.setAttribute('class', `connection-path${this.state.selectedEdgeId === edge.id ? ' selected' : ''}`);
            path.setAttribute('marker-end', 'url(#arrowhead)');
            path.style.color = this.state.selectedEdgeId === edge.id ? '#1565c0' : '#334155';
            svg.appendChild(path);

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('d', curve);
            hit.setAttribute('class', 'connection-hit');
            hit.addEventListener('click', (event) => {
                event.stopPropagation();
                this.selectEdge(edge.id);
                this.handleEdgeSplit(edge.id);
            });
            svg.appendChild(hit);
        });

        if (this.state.connectFrom && this.state.previewPoint) {
            const start = this.getPortAnchor(this.state.connectFrom.nodeId, this.state.connectFrom.portId);
            const curve = this.buildBezierPath(start, this.state.previewPoint);
            const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            preview.setAttribute('d', curve);
            preview.setAttribute('class', 'connection-preview');
            svg.appendChild(preview);
        }
    }

    buildBezierPath(start, end) {
        const dx = Math.max(60, Math.abs(end.x - start.x) * 0.5);
        const c1x = start.x + dx;
        const c2x = end.x - dx;
        return `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;
    }

    renderInspector() {
        const selectedNode = this.getNode(this.state.selectedNodeId);
        if (!selectedNode) {
            if (this.state.selectedEdgeId) {
                this.el.inspectorContent.innerHTML = '<p class="placeholder">Wire selected. Click it again to split and insert a takeoff node.</p>';
                return;
            }
            this.el.inspectorContent.innerHTML = '<p class="placeholder">Select a block to edit its properties.</p>';
            return;
        }

        let html = `
            <div class="inspector-group">
                <label>Type</label>
                <input type="text" value="${selectedNode.data.label}" readonly>
            </div>
            <div class="inspector-group">
                <label>Position X</label>
                <input id="nodeXInput" type="number" value="${Math.round(selectedNode.position.x)}">
            </div>
            <div class="inspector-group">
                <label>Position Y</label>
                <input id="nodeYInput" type="number" value="${Math.round(selectedNode.position.y)}">
            </div>
        `;

        if (!['summer', 'takeoff'].includes(selectedNode.type)) {
            html += `
                <div class="inspector-group">
                    <label>Value</label>
                    <input id="nodeValueInput" type="text" value="${selectedNode.data.value}">
                </div>
            `;
        }

        if (selectedNode.type === 'summer') {
            html += '<div class="inspector-group"><label>Input Signs</label>';
            selectedNode.ports.filter((port) => port.direction === 'input').forEach((port) => {
                html += `
                    <div class="sign-row">
                        <span>${port.id}</span>
                        <select data-sign-port="${port.id}">
                            <option value="+" ${port.sign === '+' ? 'selected' : ''}>+</option>
                            <option value="-" ${port.sign === '-' ? 'selected' : ''}>-</option>
                        </select>
                    </div>
                `;
            });
            html += '</div>';
        }

        if (selectedNode.type === 'takeoff') {
            const outgoingCount = this.state.edges.filter((edge) => edge.sourceNode === selectedNode.id).length;
            html += `
                <div class="inspector-group">
                    <label>Takeoff Routing</label>
                    <input type="text" value="1 input / ${outgoingCount} outputs" readonly>
                </div>
            `;
        }

        this.el.inspectorContent.innerHTML = html;

        const xInput = document.getElementById('nodeXInput');
        const yInput = document.getElementById('nodeYInput');
        xInput.addEventListener('input', (event) => this.updateNodePosition(selectedNode.id, 'x', event.target.value));
        yInput.addEventListener('input', (event) => this.updateNodePosition(selectedNode.id, 'y', event.target.value));

        const valueInput = document.getElementById('nodeValueInput');
        if (valueInput) {
            valueInput.addEventListener('input', (event) => this.updateNodeValue(selectedNode.id, event.target.value));
        }

        this.el.inspectorContent.querySelectorAll('[data-sign-port]').forEach((select) => {
            select.addEventListener('change', (event) => this.updateSummerSign(selectedNode.id, event.target.dataset.signPort, event.target.value));
        });
    }

    renderCounters() {
        this.el.nodeCount.textContent = String(this.state.nodes.length);
        this.el.edgeCount.textContent = String(this.state.edges.length);
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
    blocksLayer: document.getElementById('blocksLayer'),
    connectionLayer: document.getElementById('connectionLayer'),
    inspectorContent: document.getElementById('inspectorContent'),
    pointerPosition: document.getElementById('pointerPosition'),
    statusText: document.getElementById('statusText'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomResetBtn: document.getElementById('zoomResetBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    selectBtn: document.getElementById('selectBtn'),
    panBtn: document.getElementById('panBtn'),
    clearBtn: document.getElementById('clearBtn'),
    workspaceToggleBtn: document.getElementById('workspaceToggleBtn'),
    nodeCount: document.getElementById('nodeCount'),
    edgeCount: document.getElementById('edgeCount'),
    modeLabel: document.getElementById('modeLabel')
});

window.editor = editor;
