// Global state
let blocks = [];
let connections = [];
let selectedBlock = null;
let selectedConnection = null;
let isDragging = false;
let isConnecting = false;
let dragOffset = { x: 0, y: 0 };
let connectionStart = null;
let blockIdCounter = 0;
let hasMovedDuringDrag = false;
let activeTemplate = 'Custom';
let isApplyingTemplate = false;

// Advanced features state
let zoomLevel = 1.0;
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let currentMode = 'select'; // 'select' or 'pan'
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;
const API_BASE_URL = 'http://localhost:8080/api';


// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeCanvas();
    initializeToolbar();
    initializeEventListeners();
    initializeAdvancedFeatures();
    initializeTemplateGallery();
    initializeToolbarSearch();
    setActiveTemplateLabel('Custom');
    saveState(); // Initial state
});

// Initialize Canvas
function initializeCanvas() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    
    // Resize canvas to fit container
    function resizeCanvas() {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        redrawConnections();
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

// Initialize Toolbar
function initializeToolbar() {

    const blockItems = document.querySelectorAll(".block-item");

    blockItems.forEach(item => {

        item.setAttribute("draggable", "true");

        item.addEventListener("dragstart", handleDragStart);

        item.addEventListener("dragend", handleDragEnd);

    });
}
function initializeToolbarSearch() {
    const searchInput = document.getElementById('blockSearch');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.block-item').forEach(item => {
            const label = item.innerText.toLowerCase();
            item.style.display = label.includes(term) ? 'flex' : 'none';
        });
    });
}

function initializeTemplateGallery() {
    const container = document.getElementById('templateCards');
    if (!container) return;
    
    container.innerHTML = '';
    diagramTemplates.forEach(template => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'template-card';
        card.innerHTML = `
            <strong>${template.name}</strong>
            <span>${template.description}</span>
            <span>${template.difficulty} • ${template.blueprint.blocks.length} blocks</span>
        `;
        card.addEventListener('click', () => handleTemplateSelection(template.id));
        container.appendChild(card);
    });
}

function handleTemplateSelection(templateId) {
    const template = diagramTemplates.find(t => t.id === templateId);
    if (!template) return;
    
    const confirmation = confirm(`Load the "${template.name}" template?\n\nThis will replace the current diagram.`);
    if (!confirmation) return;
    
    isApplyingTemplate = true;
    const diagramData = {
        name: template.name,
        blocks: JSON.parse(JSON.stringify(template.blueprint.blocks)),
        connections: JSON.parse(JSON.stringify(template.blueprint.connections)),
        metadata: {
            templateName: template.name,
            difficulty: template.difficulty
        }
    };
    loadDiagramData(diagramData);
    isApplyingTemplate = false;
    updateStatus(`Loaded template: ${template.name}`);
}

// Handle drag start from toolbar
function handleDragStart(e) {

    const item = e.target.closest('.block-item');

    if (!item) return;

    const blockType = item.dataset.type;

    e.dataTransfer.setData("text/plain", blockType);

    e.dataTransfer.effectAllowed = "copy";
}

// Handle drag end from toolbar
function handleDragEnd(e) {
    // Cleanup if needed
}
function initializeEventListeners() {

    const workspace = document.querySelector(".workspace");
    const canvas = document.getElementById("canvas");

    // Allow drop
    workspace.addEventListener("dragover", function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    // Handle drop
    workspace.addEventListener("drop", function(e) {

        e.preventDefault();

        const blockType = e.dataTransfer.getData("text/plain");
        if (!blockType) return;

        const rect = workspace.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        createBlock(blockType, x, y);

    });

    canvas.addEventListener("mousedown", handleCanvasMouseDown);
    canvas.addEventListener("mousemove", handleCanvasMouseMove);
    canvas.addEventListener("mouseup", handleCanvasMouseUp);
    canvas.addEventListener("click", handleCanvasClick);

    // Update coordinates
    workspace.addEventListener("mousemove", (e) => {
        const rect = workspace.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        document.getElementById("coordinates").textContent = `X: ${x}, Y: ${y}`;
    });

    // Button events
    document.getElementById("saveBtn").addEventListener("click", saveToServer);
    document.getElementById("loadBtn").addEventListener("click", loadFromServer);
    document.getElementById("undoBtn").addEventListener("click", undo);
    document.getElementById("redoBtn").addEventListener("click", redo);
    document.getElementById("clearBtn").addEventListener("click", clearCanvas);
    document.getElementById("reduceBtn").addEventListener("click", reduceGraph);
    document.getElementById("exportBtn").addEventListener("click", exportCanvas);

    // Keyboard shortcuts
    document.addEventListener("keydown", handleKeyboardShortcuts);

    updateCounters();
}

// Create Block
function createBlock(type, x, y) {

    blockIdCounter++;

    const block = {
        id: blockIdCounter,
        type: type,
        x: x - 50,
        y: y - 30,
        width: type === "summer" ? 60 : 100,
        height: type === "summer" ? 60 : 60,
        value: getDefaultValue(type),
        label: getBlockLabel(type),
        // For summers we want a standard 2-input junction: one positive, one negative
        inputs: type === "summer"
            ? [
                { from: null, sign: '+' },
                { from: null, sign: '-' }
              ]
            : null
    };

    blocks.push(block);

    renderBlock(block);

    redrawConnections();

    updateCounters();
}
// Get default value for block type
function getDefaultValue(type) {
    const defaults = {
        'gain': '1',
        'summer': 'X',
        'integrator': '1/s',
        'differentiator': 's',
        'node': '',
        'branch': '1',
        'input': 'R(s)',
        'output': 'C(s)'
    };
    return defaults[type] || '';
}

// Get block label
function getBlockLabel(type) {
    const labels = {
        'gain': 'Gain',
        'summer': 'Summer',
        'integrator': 'Integrator',
        'differentiator': 'Differentiator',
        'node': 'Node',
        'branch': 'Branch',
        'input': 'Input',
        'output': 'Output'
    };
    return labels[type] || type;
}

// Render Block
function renderBlock(block) {
    const blocksContainer = document.getElementById('blocks-container');
    
    const blockElement = document.createElement('div');
    blockElement.className = 'block';
    blockElement.dataset.id = block.id;
    blockElement.style.left = block.x + 'px';
    blockElement.style.top = block.y + 'px';
    
    // Special rendering for summer (summing junction - circle)
    if (block.type === 'summer') {
        blockElement.innerHTML = `
            <div class="block-content summer-content">
                <svg width="60" height="60" viewBox="0 0 60 60">
                    <circle cx="30" cy="30" r="25" fill="white" stroke="#e74c3c" stroke-width="3"/>
                    <text x="30" y="38" text-anchor="middle" font-size="24" fill="#e74c3c" font-weight="bold">Σ</text>
                </svg>
            </div>
            <div class="connection-point output" data-point="output"></div>
        `;
    } else if (block.type === 'takeoff') {
        // Special rendering for take-off node with one input and three outputs
        blockElement.innerHTML = `
            <div class="block-content takeoff-content">
                <svg width="40" height="40" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="8" fill="white" stroke="#2980b9" stroke-width="3"/>
                </svg>
            </div>
            <div class="connection-point input" data-point="input"
                 style="left:-6px; top:50%; transform:translateY(-50%);"></div>
            <div class="connection-point output" data-point="output"
                 style="right:-6px; top:50%; transform:translateY(-50%);"></div>
            <div class="connection-point output" data-point="output"
                 style="right:-6px; top:20%; transform:translateY(-50%);"></div>
            <div class="connection-point output" data-point="output"
                 style="right:-6px; top:80%; transform:translateY(-50%);"></div>
        `;
    } else {
        blockElement.innerHTML = `
            <div class="block-content">
                <div class="block-label">${block.label}</div>
                <div class="block-value">${block.value}</div>
            </div>
            <div class="connection-point input" data-point="input"></div>
            <div class="connection-point output" data-point="output"></div>
        `;
    }
    
    // Add event listeners
    blockElement.addEventListener('mousedown', (e) => handleBlockMouseDown(e, block));
    blockElement.querySelectorAll('.connection-point').forEach(point => {
        point.addEventListener('mousedown', (e) => handleConnectionPointMouseDown(e, block, point));
    });
    
    blocksContainer.appendChild(blockElement);
    
    // For summer blocks, update input points after rendering
    if (block.type === 'summer') {
        updateSummerInputs(block);
    }
    
    updateBlockSelection(block.id);
}

// Handle block mouse down
function handleBlockMouseDown(e, block) {
    if (e.target.classList.contains('connection-point')) return;
    
    e.stopPropagation();
    selectedBlock = block;
    isDragging = true;
    hasMovedDuringDrag = false;
    
    const blockElement = document.querySelector(`[data-id="${block.id}"]`);
    const rect = blockElement.getBoundingClientRect();
    const workspace = document.querySelector('.workspace');
    const workspaceRect = workspace.getBoundingClientRect();
    
    dragOffset.x = e.clientX - rect.left - workspaceRect.left;
    dragOffset.y = e.clientY - rect.top - workspaceRect.top;
    
    updateBlockSelection(block.id);
    updatePropertiesPanel(block);
}

// Handle connection point mouse down
function handleConnectionPointMouseDown(e, block, point) {
    e.stopPropagation();
    const pointType = point.dataset.point;
    
    if (!isConnecting) {
        // Start new connection
        isConnecting = true;
        connectionStart = {
            block: block,
            type: pointType,
            element: point
        };
        updateStatus('Click on another connection point to connect');
    } else {
        // Complete connection
        if (connectionStart.block.id !== block.id && pointType !== connectionStart.type) {
            createConnection(connectionStart.block, connectionStart.type, block, pointType);
        }
        isConnecting = false;
        connectionStart = null;
        updateStatus('Ready');
    }
}

// Create Connection
function createConnection(fromBlock, fromType, toBlock, toType) {
    // Ensure we're connecting output to input
    if (fromType === 'input' || toType === 'output') {
        
    // For summer blocks, allow multiple inputs
    
        // Initialize inputs array if not exists
        if (!toBlock.inputs) {
            toBlock.inputs = [];
        }
        
        // Check if connection already exists
        const existingInput = toBlock.inputs.find(inp => inp.from === fromBlock.id);
        if (existingInput) {
            updateStatus('Connection already exists');
            return;
        }
        
        // Add input with default positive sign
        toBlock.inputs.push({
            from: fromBlock.id,
            sign: '+'  // Default to positive, can be changed in properties
        });
        
        // Update summer rendering to show input signs
        updateSummerInputs(toBlock);
    }
}

// Create Connection
function createConnection(fromBlock, fromType, toBlock, toType, inputIndex = null) {

    // Ensure we're connecting output to input
    if (fromType === 'input' || toType === 'output') {
        [fromBlock, toBlock] = [toBlock, fromBlock];
        [fromType, toType] = [toType, fromType];
    }

    // Prevent duplicate connection to same input
    const duplicateConnection = connections.find(c =>
        c.from === fromBlock.id &&
        c.to === toBlock.id &&
        c.inputIndex === inputIndex
    );

    if (duplicateConnection) {
        updateStatus("Connection already exists");
        return;
    }

    // =============================
    // SUMMER BLOCK CONNECTION LOGIC (standard 2-input junction)
    // =============================
    if (toBlock.type === 'summer') {

        // Ensure inputs array exists as exactly two slots: one + and one -
        if (!Array.isArray(toBlock.inputs) || toBlock.inputs.length !== 2) {
            toBlock.inputs = [
                { from: null, sign: '+' },
                { from: null, sign: '-' }
            ];
        }

        let targetIndex = inputIndex;

        // If no slot specified, find empty one
        if (targetIndex === null || targetIndex === undefined) {
            targetIndex = toBlock.inputs.findIndex(inp => inp.from === null);

            if (targetIndex === -1) {
                // All slots full → overwrite first
                targetIndex = 0;

                const oldConnection = connections.find(c =>
                    c.to === toBlock.id && c.inputIndex === targetIndex
                );

                if (oldConnection) {
                    connections = connections.filter(c => c.id !== oldConnection.id);
                }
            }
        }

        // Remove existing connection occupying slot
        if (toBlock.inputs[targetIndex].from !== null) {

            const oldConnection = connections.find(c =>
                c.to === toBlock.id && c.inputIndex === targetIndex
            );

            if (oldConnection) {
                connections = connections.filter(c => c.id !== oldConnection.id);
            }
        }

        const connection = {
            id: Date.now(),
            from: fromBlock.id,
            fromType: 'output',
            to: toBlock.id,
            toType: 'input',
            inputIndex: targetIndex
        };

        connections.push(connection);

        // Assign slot
        toBlock.inputs[targetIndex].from = fromBlock.id;

        if (!toBlock.inputs[targetIndex].sign) {
            toBlock.inputs[targetIndex].sign = '+';
        }

        // Update rendering
        updateSummerInputs(toBlock);
    }

    // =============================
    // NORMAL BLOCK CONNECTION
    // =============================
    else {

        const connection = {
            id: Date.now(),
            from: fromBlock.id,
            fromType: 'output',
            to: toBlock.id,
            toType: 'input',
            inputIndex: null
        };

        connections.push(connection);
    }

    // =============================
    // UPDATE UI
    // =============================
    redrawConnections();

    updateStatus(`Connected ${fromBlock.label} to ${toBlock.label}`);

    flagManualChange();

    saveState();

    updateCounters();
}

// Update Summer Inputs Display
function updateSummerInputs(block) {
    const blockElement = document.querySelector(`[data-id="${block.id}"]`);
    if (!blockElement || block.type !== 'summer') return;
    
    // Remove existing input points
    blockElement.querySelectorAll('.summer-input').forEach(point => point.remove());
    
    // Ensure standard 2-input configuration (one +, one -)
    if (!Array.isArray(block.inputs) || block.inputs.length !== 2) {
        const existing = Array.isArray(block.inputs) ? block.inputs : [];
        block.inputs = [
            {
                from: existing[0]?.from ?? null,
                sign: existing[0]?.sign || '+'
            },
            {
                from: existing[1]?.from ?? null,
                sign: existing[1]?.sign || '-'
            }
        ];
    }

    // Add input points for each configured input
    if (block.inputs && block.inputs.length > 0) {
        const numInputs = block.inputs.length;
        const spacing = 60 / (numInputs + 1);
        
        block.inputs.forEach((input, index) => {
            const inputPoint = document.createElement('div');
            inputPoint.className = `connection-point input summer-input`;
            inputPoint.dataset.point = 'input';
            inputPoint.dataset.sign = input.sign;
            inputPoint.dataset.inputIndex = index;
            inputPoint.style.left = '-6px';
            inputPoint.style.top = `${(index + 1) * spacing}px`;
            inputPoint.style.transform = 'translateY(-50%)';
            
            // Add sign indicator
            const signLabel = document.createElement('div');
            signLabel.className = 'summer-sign-label';
            signLabel.textContent = input.sign;
            signLabel.style.position = 'absolute';
            signLabel.style.left = '-20px';
            signLabel.style.top = '50%';
            signLabel.style.transform = 'translateY(-50%)';
            signLabel.style.color = input.sign === '+' ? '#27ae60' : '#e74c3c';
            signLabel.style.fontWeight = 'bold';
            signLabel.style.fontSize = '16px';
            inputPoint.appendChild(signLabel);
            
            inputPoint.addEventListener('mousedown', (e) => handleConnectionPointMouseDown(e, block, inputPoint));
            blockElement.appendChild(inputPoint);
        });
    }
}

// Redraw Connections
function redrawConnections() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw arrow marker definition
    if (!document.getElementById('arrowhead')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3, 0 6');
        polygon.setAttribute('fill', '#34495e');
        marker.appendChild(polygon);
        defs.appendChild(marker);
    }
    
    // Draw connections
    connections.forEach(conn => {
        const fromBlock = blocks.find(b => b.id === conn.from);
        const toBlock = blocks.find(b => b.id === conn.to);
        
        if (fromBlock && toBlock) {
            const fromX = fromBlock.x + fromBlock.width;
            const fromY = fromBlock.y + fromBlock.height / 2;
            
            // For summer blocks, calculate input position based on input index
            let toX, toY;
            if (toBlock.type === 'summer' && toBlock.inputs && conn.inputIndex !== null) {
                const numInputs = toBlock.inputs.length;
                const spacing = toBlock.height / (numInputs + 1);
                toX = toBlock.x;
                toY = toBlock.y + (conn.inputIndex + 1) * spacing;
            } else {
                toX = toBlock.x;
                toY = toBlock.y + toBlock.height / 2;
            }

            ctx.strokeStyle = selectedConnection === conn.id ? '#667eea' : '#34495e';
            ctx.lineWidth = selectedConnection === conn.id ? 3 : 2;

            // Decide if this looks like a feedback connection (going backwards in x)
            const isFeedback = toX < fromX;
            const verticalOffset = 60; // how far above/below to route feedback

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);

            if (isFeedback) {
                // Orthogonal routing for feedback path: right, up/down, left, then into block
                const midY = fromY - verticalOffset;
                const approachX = toX - 30;

                ctx.lineTo(fromX + 30, fromY);      // small horizontal out
                ctx.lineTo(fromX + 30, midY);       // vertical segment
                ctx.lineTo(approachX, midY);        // horizontal over the diagram
                ctx.lineTo(approachX, toY);         // vertical down to input level
                ctx.lineTo(toX, toY);               // final short horizontal into block
            } else {
                // Forward path: simple horizontal + vertical dog-leg instead of a curve
                const midX = fromX + (toX - fromX) * 0.5;
                ctx.lineTo(midX, fromY);
                ctx.lineTo(midX, toY);
                ctx.lineTo(toX, toY);
            }

            ctx.stroke();

            // Draw arrowhead for both cases
            const arrowLength = 10;
            const angle = Math.atan2(0, -1); // default left-pointing
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(
                toX - arrowLength * Math.cos(angle - Math.PI / 6),
                toY - arrowLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(toX, toY);
            ctx.lineTo(
                toX - arrowLength * Math.cos(angle + Math.PI / 6),
                toY - arrowLength * Math.sin(angle + Math.PI / 6)
            );
            ctx.stroke();
        }
    });
}

// Handle Canvas Mouse Down
function handleCanvasMouseDown(e) {
    if (e.target === document.getElementById('canvas')) {
        selectedBlock = null;
        selectedConnection = null;
        updateBlockSelection(null);
        updatePropertiesPanel(null);
    }
}

// Handle Canvas Mouse Move
function handleCanvasMouseMove(e) {
    if (isDragging && selectedBlock) {
        const workspace = document.querySelector('.workspace');
        const rect = workspace.getBoundingClientRect();
        
        selectedBlock.x = e.clientX - rect.left - dragOffset.x;
        selectedBlock.y = e.clientY - rect.top - dragOffset.y;
        
        const blockElement = document.querySelector(`[data-id="${selectedBlock.id}"]`);
        if (blockElement) {
            blockElement.style.left = selectedBlock.x + 'px';
            blockElement.style.top = selectedBlock.y + 'px';
        }
        
        if (!hasMovedDuringDrag) {
            flagManualChange();
        }
        hasMovedDuringDrag = true;
        redrawConnections();
    }
}

// Handle Canvas Mouse Up
function handleCanvasMouseUp(e) {
    if (hasMovedDuringDrag) {
        saveState();
        updateCounters();
        hasMovedDuringDrag = false;
    }
    isDragging = false;
}

// Handle Canvas Click
function handleCanvasClick(e) {
    // Handle connection selection if clicking on a line (simplified)
}

// Update Block Selection
function updateBlockSelection(blockId) {
    document.querySelectorAll('.block').forEach(block => {
        block.classList.remove('selected');
    });
    
    if (blockId) {
        const blockElement = document.querySelector(`[data-id="${blockId}"]`);
        if (blockElement) {
            blockElement.classList.add('selected');
        }
    }
}

// Update Properties Panel
function updatePropertiesPanel(block) {
    const propertiesContent = document.getElementById('properties-content');
    
    if (!block) {
        propertiesContent.innerHTML = '<p class="placeholder">Select a block to edit properties</p>';
        return;
    }
    
    let html = `
        <div class="property-group">
            <label>Type</label>
            <input type="text" value="${block.label}" readonly>
        </div>
    `;
    
    // For summer blocks, show input signs configuration
    if (block.type === 'summer' && block.inputs && block.inputs.length > 0) {
        html += `<div class="property-group">
            <label>Input Signs (Positive/Negative Feedback)</label>`;
        
        block.inputs.forEach((input, index) => {
            const fromBlock = blocks.find(b => b.id === input.from);
            const blockName = fromBlock ? fromBlock.label : `Input ${index + 1}`;
            html += `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                    <span style="flex: 1; font-size: 12px;">${blockName}:</span>
                    <button class="btn ${input.sign === '+' ? 'btn-primary' : 'btn-secondary'}" 
                            onclick="toggleInputSign(${block.id}, ${index})" 
                            style="min-width: 40px; padding: 4px 8px;">
                        ${input.sign}
                    </button>
                </div>
            `;
        });
        
        html += `</div>`;
    } else if (block.type !== 'summer') {
        html += `
        <div class="property-group">
            <label>Value</label>
            <input type="text" id="block-value-input" value="${block.value}" 
                   onchange="updateBlockValue(${block.id}, this.value)">
        </div>`;
    }
    
    html += `
        <div class="property-group">
            <label>Position X</label>
            <input type="number" id="block-x-input" value="${block.x}" 
                   onchange="updateBlockPosition(${block.id}, 'x', this.value)">
        </div>
        <div class="property-group">
            <label>Position Y</label>
            <input type="number" id="block-y-input" value="${block.y}" 
                   onchange="updateBlockPosition(${block.id}, 'y', this.value)">
        </div>
        <div class="property-group">
            <button class="btn btn-secondary" onclick="deleteBlock(${block.id})" 
                    style="width: 100%; margin-top: 10px;">Delete Block</button>
        </div>
    `;
    
    propertiesContent.innerHTML = html;
}

// Toggle Input Sign for Summer Block
function toggleInputSign(blockId, inputIndex) {
    const block = blocks.find(b => b.id === blockId);
    if (block && block.type === 'summer' && block.inputs && block.inputs[inputIndex]) {
        // Toggle between + and -
        block.inputs[inputIndex].sign = block.inputs[inputIndex].sign === '+' ? '-' : '+';
        updateSummerInputs(block);
        updatePropertiesPanel(block);
        updateStatus(`Changed input sign to ${block.inputs[inputIndex].sign}`);
        flagManualChange();
        redrawConnections();
        saveState();
        updateCounters();
    }
}

// Update Block Value
function updateBlockValue(blockId, value) {
    const block = blocks.find(b => b.id === blockId);
    if (block) {
        block.value = value;
        const blockElement = document.querySelector(`[data-id="${blockId}"]`);
        if (blockElement) {
            blockElement.querySelector('.block-value').textContent = value;
        }
        updateStatus(`Updated ${block.label} value to ${value}`);
        flagManualChange();
        saveState();
        updateCounters();
    }
}

// Update Block Position
function updateBlockPosition(blockId, axis, value) {
    const block = blocks.find(b => b.id === blockId);
    if (block) {
        block[axis] = parseInt(value);
        const blockElement = document.querySelector(`[data-id="${blockId}"]`);
        if (blockElement) {
            blockElement.style[axis] = value + 'px';
        }
        redrawConnections();
        flagManualChange();
        saveState();
        updateCounters();
    }
}

// Delete Block
function deleteBlock(blockId) {
    // Remove connections involving this block
    connections.forEach(c => {
        if (c.to === blockId) {
            // If deleting a block that receives input from a summer, clean up summer inputs
            const toBlock = blocks.find(b => b.id === c.to);
            if (toBlock && toBlock.type === 'summer' && toBlock.inputs) {
                toBlock.inputs = toBlock.inputs.filter(inp => inp.from !== c.from);
                updateSummerInputs(toBlock);
            }
        } else if (c.from === blockId) {
            // If deleting a block that sends output to a summer, remove from summer inputs
            const toBlock = blocks.find(b => b.id === c.to);
            if (toBlock && toBlock.type === 'summer' && toBlock.inputs) {
                toBlock.inputs = toBlock.inputs.filter(inp => inp.from !== blockId);
                updateSummerInputs(toBlock);
            }
        }
    });
    
    connections = connections.filter(c => c.from !== blockId && c.to !== blockId);
    blocks = blocks.filter(b => b.id !== blockId);
    
    const blockElement = document.querySelector(`[data-id="${blockId}"]`);
    if (blockElement) {
        blockElement.remove();
    }
    
    redrawConnections();
    updatePropertiesPanel(null);
    updateStatus('Block deleted');
    flagManualChange();
    saveState();
    updateCounters();
}

// Clear Canvas
function clearCanvas() {
    if (confirm('Are you sure you want to clear the canvas?')) {
        blocks = [];
        connections = [];
        selectedBlock = null;
        document.getElementById('blocks-container').innerHTML = '';
        redrawConnections();
        updatePropertiesPanel(null);
        updateStatus('Canvas cleared');
        flagManualChange();
        saveState();
        updateCounters();
    }
}

// Initialize Advanced Features
function initializeAdvancedFeatures() {
    // Zoom controls
    document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoomLevel + 0.1));
    document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoomLevel - 0.1));
    document.getElementById('zoomReset').addEventListener('click', () => setZoom(1.0));
    
    // View mode controls
    document.getElementById('panBtn').addEventListener('click', () => setMode('pan'));
    document.getElementById('selectBtn').addEventListener('click', () => setMode('select'));
    
    // Pan functionality
    const canvasWrapper = document.getElementById('canvas-wrapper');
    canvasWrapper.addEventListener('mousedown', handlePanStart);
    canvasWrapper.addEventListener('mousemove', handlePanMove);
    canvasWrapper.addEventListener('mouseup', handlePanEnd);
    canvasWrapper.addEventListener('mouseleave', handlePanEnd);
    
    // Mouse wheel zoom
    canvasWrapper.addEventListener('wheel', handleWheelZoom, { passive: false });
}

// Zoom Functions
function setZoom(level) {
    zoomLevel = Math.max(0.1, Math.min(3.0, level));
    const canvasWrapper = document.getElementById('canvas-wrapper');
    canvasWrapper.style.transform = `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`;
    document.getElementById('zoomLevel').textContent = Math.round(zoomLevel * 100) + '%';
}

function handleWheelZoom(e) {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(zoomLevel + delta);
    }
}

// Pan Functions
function setMode(mode) {
    currentMode = mode;
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const panBtn = document.getElementById('panBtn');
    const selectBtn = document.getElementById('selectBtn');
    
    if (mode === 'pan') {
        canvasWrapper.classList.add('panning');
        panBtn.classList.add('active');
        selectBtn.classList.remove('active');
    } else {
        canvasWrapper.classList.remove('panning');
        panBtn.classList.remove('active');
        selectBtn.classList.add('active');
    }
}

function handlePanStart(e) {
    if (currentMode === 'pan' || e.button === 1) {
        isPanning = true;
        panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
        e.preventDefault();
    }
}

function handlePanMove(e) {
    if (isPanning) {
        panOffset.x = e.clientX - panStart.x;
        panOffset.y = e.clientY - panStart.y;
        const canvasWrapper = document.getElementById('canvas-wrapper');
        canvasWrapper.style.transform = `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`;
    }
}

function handlePanEnd(e) {
    isPanning = false;
}

// Undo/Redo Functions
function saveState() {
    const state = {
        blocks: JSON.parse(JSON.stringify(blocks)),
        connections: JSON.parse(JSON.stringify(connections)),
        blockIdCounter: blockIdCounter,
        templateLabel: activeTemplate
    };
    
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    
    history.push(state);
    historyIndex++;
    
    if (history.length > MAX_HISTORY) {
        history.shift();
        historyIndex--;
    }
    
    updateUndoRedoButtons();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreState(history[historyIndex]);
        updateStatus('Undone');
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        restoreState(history[historyIndex]);
        updateStatus('Redone');
    }
}

function restoreState(state) {
    blocks = JSON.parse(JSON.stringify(state.blocks));
    connections = JSON.parse(JSON.stringify(state.connections));
    blockIdCounter = state.blockIdCounter;
    setActiveTemplateLabel(state.templateLabel || 'Custom');
    
    document.getElementById('blocks-container').innerHTML = '';
    blocks.forEach(block => renderBlock(block));
    redrawConnections();
    updateCounters();
    updatePropertiesPanel(null);
}

function updateUndoRedoButtons() {
    document.getElementById('undoBtn').disabled = historyIndex <= 0;
    document.getElementById('redoBtn').disabled = historyIndex >= history.length - 1;
}

// Keyboard Shortcuts
function handleKeyboardShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
    }
    if (e.key === ' ') {
        e.preventDefault();
        setMode('pan');
    }
    if (e.key === 'Escape') {
        setMode('select');
    }
    if (e.key === 'Delete' && selectedBlock) {
        deleteBlock(selectedBlock.id);
    }
}

// Update Counters
function updateCounters() {
    const blockCountEl = document.getElementById('block-count');
    const connectionCountEl = document.getElementById('connection-count');
    if (blockCountEl) blockCountEl.textContent = `Blocks: ${blocks.length}`;
    if (connectionCountEl) connectionCountEl.textContent = `Connections: ${connections.length}`;
    updateInsightsPanel();
}

function updateInsightsPanel() {
    const feedbackEl = document.getElementById('feedbackCount');
    const badgeEl = document.getElementById('complexityBadge');
    if (!feedbackEl|| !badgeEl) return;
    
    const feedbackLoops = getFeedbackLoopCount();
    const complexity = getComplexityLevel(blocks.length, feedbackLoops);
    
    feedbackEl.textContent = feedbackLoops;
    badgeEl.textContent = complexity.label;
    badgeEl.dataset.level = complexity.level;
}

function getFeedbackLoopCount() {
    return connections.reduce((count, conn) => {
        const toBlock = blocks.find(b => b.id === conn.to);
        if (toBlock && toBlock.type === 'summer' && Array.isArray(toBlock.inputs) && conn.inputIndex !== null) {
            const input = toBlock.inputs[conn.inputIndex];
            if (input && input.sign === '-') {
                return count + 1;
            }
        }
        return count;
    }, 0);
}



function setActiveTemplateLabel(label) {
    activeTemplate = label || 'Custom';
    const statusEl = document.getElementById('templateStatus');
    if (statusEl) {
        statusEl.textContent = activeTemplate;
    }
}

function flagManualChange() {
    if (!isApplyingTemplate && activeTemplate !== 'Custom') {
        setActiveTemplateLabel('Custom');
    }
}

// Save/Load Functions
async function saveToServer() {
    const diagramName = prompt('Enter diagram name:', 'My Diagram') || 'My Diagram';
    const diagramData = {
        name: diagramName,
        blocks: blocks,
        connections: connections,
        metadata: {
            created: new Date().toISOString(),
            version: '1.0',
            templateName: activeTemplate
        }
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/diagrams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(diagramData)
        });
        
        if (response.ok) {
            const result = await response.json();
            updateStatus(`Diagram saved: ${result.name}`);
            alert(`Diagram saved!\nID: ${result.id}\nName: ${result.name}`);
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        localStorage.setItem('diagram_backup', JSON.stringify(diagramData));
        updateStatus('Saved to local storage');
        alert('Server unavailable. Saved to local storage.');
    }
}

async function loadFromServer() {
    try {
        const response = await fetch(`${API_BASE_URL}/diagrams`);
        if (response.ok) {
            const diagrams = await response.json();
            if (diagrams.length === 0) {
                alert('No saved diagrams found.');
                return;
            }
            const diagramList = diagrams.map((d, i) => `${i + 1}. ${d.name} (ID: ${d.id})`).join('\n');
            const choice = prompt(`Available diagrams:\n\n${diagramList}\n\nEnter diagram ID:`);
            if (choice) {
                const diagramId = parseInt(choice);
                const diagram = diagrams.find(d => d.id === diagramId);
                if (diagram) {
                    if (confirm(`Load "${diagram.name}"?`)) {
                        loadDiagramData(diagram);
                    }
                } else {
                    alert('Diagram not found!');
                }
            }
        } else {
            throw new Error('Failed to load');
        }
    } catch (error) {
        const backup = localStorage.getItem('diagram_backup');
        if (backup) {
            if (confirm('Server unavailable. Load from local backup?')) {
                loadDiagramData(JSON.parse(backup));
            }
        } else {
            alert('Server unavailable and no backup found.');
        }
    }
}

function loadDiagramData(diagramData) {
    blocks = JSON.parse(JSON.stringify(diagramData.blocks || []));
    connections = JSON.parse(JSON.stringify(diagramData.connections || []));
    blockIdCounter = blocks.reduce((max, block) => Math.max(max, block.id || 0), 0);
    document.getElementById('blocks-container').innerHTML = '';
    blocks.forEach(block => renderBlock(block));
    redrawConnections();
    updateCounters();
    saveState();
    const templateLabel = diagramData.metadata?.templateName || diagramData.name || 'Imported';
    setActiveTemplateLabel(templateLabel);
    updateStatus(`Loaded: ${diagramData.name || 'Diagram'}`);
}

// Enhanced Reduce Graph with API call
async function reduceGraph() {
    if (blocks.length === 0) {
        alert('Please add blocks to the canvas first');
        return;
    }
    
    const graphData = { blocks: blocks, connections: connections };
    
    try {
        updateStatus('Reducing graph...');
        const response = await fetch(`${API_BASE_URL}/reduce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(graphData)
        });
        
        if (response.ok) {
            const result = await response.json();
            const message = `Graph Reduced!\n\nOriginal: ${blocks.length} blocks\n` +
                          `Reduced: ${result.reducedBlocks?.length || 0} blocks\n` +
                          `Transfer Function: ${result.transferFunction || 'N/A'}\n\nApply?`;
            
            if (confirm(message)) {
                if (result.reducedBlocks && result.reducedConnections) {
                    blocks = result.reducedBlocks;
                    connections = result.reducedConnections;
                    document.getElementById('blocks-container').innerHTML = '';
                    blocks.forEach(block => renderBlock(block));
                    redrawConnections();
                    updateCounters();
                    saveState();
                    setActiveTemplateLabel('Reduced Graph');
                    updateStatus('Graph reduced successfully');
                }
            }
        } else {
            throw new Error('Reduction failed');
        }
    } catch (error) {
        updateStatus('Reduction failed: ' + error.message);
        alert('Server error. Make sure backend is running on port 8080.');
    }
}

// Export Canvas
function exportCanvas() {
    const canvas = document.getElementById('canvas');
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'block-diagram.png';
    link.href = dataURL;
    link.click();
    updateStatus('Canvas exported');
}

// Update Status
function updateStatus(message) {
    document.getElementById('status-text').textContent = message;
    setTimeout(() => {
        document.getElementById('status-text').textContent = 'Ready';
    }, 3000);
}

// Make functions globally available
window.updateBlockValue = updateBlockValue;
window.updateBlockPosition = updateBlockPosition;
window.deleteBlock = deleteBlock;
window.toggleInputSign = toggleInputSign;