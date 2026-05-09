/**
 * Control Systems Block Diagram Backend Engine
 * --------------------------------------------
 * Pure computation & graph manipulation logic for reducing control-system
 * block diagrams to an equivalent single transfer function.
 *
 * Tech: Plain JavaScript with JSDoc types for clarity and easy TS adoption.
 *
 * This module is UI-agnostic. The frontend should:
 *   - construct a BlockDiagram instance using addBlock/connectBlocks, then
 *   - call reduceDiagram() to get the final transfer function and
 *     a step-by-step reduction log suitable for animation in the UI.
 */

/* ============================================================================
 * Transfer Function Utilities
 * ==========================================================================*/

/**
 * Multiply two polynomials represented as coefficient arrays.
 * Coefficients are ordered from highest to lowest power of s.
 * Example: [1, 2] => 1*s + 2
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]}
 */
function polyMultiply(a, b) {
  const res = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      res[i + j] += a[i] * b[j];
    }
  }
  return res;
}

/**
 * Add (or subtract) two polynomials represented as coefficient arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @param {1|-1} sign +1 for addition, -1 for subtraction
 * @returns {number[]}
 */
function polyAdd(a, b, sign = 1) {
  const maxLen = Math.max(a.length, b.length);
  const res = new Array(maxLen).fill(0);
  for (let i = 0; i < maxLen; i++) {
    const ai = a[a.length - maxLen + i] ?? 0;
    const bi = b[b.length - maxLen + i] ?? 0;
    res[i] = ai + sign * bi;
  }
  return res;
}

/**
 * Remove leading zeros and normalise scale (optional).
 * Currently we:
 *   - trim leading zeros
 *   - if denominator leading coeff != 0, scale so that den[0] === 1
 *
 * @param {number[]} num
 * @param {number[]} den
 * @returns {{ num: number[], den: number[] }}
 */
function normaliseRational(num, den) {
  const trim = (p) => {
    let i = 0;
    while (i < p.length - 1 && Math.abs(p[i]) === 0) i++;
    return p.slice(i);
  };

  let n = trim(num);
  let d = trim(den);

  if (d.length === 0 || Math.abs(d[0]) === 0) {
    // avoid division by zero; leave as-is
    return { num: n, den: d };
  }

  const scale = d[0];
  if (Math.abs(scale - 1) < 1e-12) {
    return { num: n, den: d };
  }

  n = n.map((c) => c / scale);
  d = d.map((c) => c / scale);
  return { num: n, den: d };
}

/**
 * Transfer function G(s) = num(s) / den(s)
 */
class TransferFunction {
  /**
   * @param {number[]} num
   * @param {number[]} den
   */
  constructor(num, den) {
    if (!Array.isArray(num) || !Array.isArray(den) || den.length === 0) {
      throw new Error('Invalid transfer function arrays');
    }
    const norm = normaliseRational(num, den);
    /** @type {number[]} */
    this.num = norm.num;
    /** @type {number[]} */
    this.den = norm.den;
  }

  /**
   * Convenience: constant gain K => K / 1
   * @param {number} k
   * @returns {TransferFunction}
   */
  static fromGain(k) {
    return new TransferFunction([k], [1]);
  }

  /**
   * Deep clone.
   * @returns {TransferFunction}
   */
  clone() {
    return new TransferFunction([...this.num], [...this.den]);
  }

  /**
   * Series: G = this * other
   * @param {TransferFunction} other
   * @returns {TransferFunction}
   */
  series(other) {
    const num = polyMultiply(this.num, other.num);
    const den = polyMultiply(this.den, other.den);
    return new TransferFunction(num, den);
  }

  /**
   * Parallel: G = this ± other
   * Implements:
   *   G = G1 + sign * G2
   *   => num = n1*d2 + sign*n2*d1
   *      den = d1*d2
   *
   * @param {TransferFunction} other
   * @param {1|-1} sign +1 for addition, -1 for subtraction
   * @returns {TransferFunction}
   */
  parallel(other, sign = 1) {
    const n1d2 = polyMultiply(this.num, other.den);
    const n2d1 = polyMultiply(other.num, this.den);
    const num = polyAdd(n1d2, n2d1, sign);
    const den = polyMultiply(this.den, other.den);
    return new TransferFunction(num, den);
  }

  /**
   * Simple feedback:
   *   Forward = this (G)
   *   Feedback = H
   *   Closed loop (negative): G / (1 + G*H)
   *   Closed loop (positive): G / (1 - G*H)
   *
   * @param {TransferFunction} H
   * @param {'negative'|'positive'} feedbackType
   * @returns {TransferFunction}
   */
  feedback(H, feedbackType = 'negative') {
    // GH
    const GH_num = polyMultiply(this.num, H.num);
    const GH_den = polyMultiply(this.den, H.den);

    // 1 ± GH => (GH_den ± GH_num) / GH_den
    const sign = feedbackType === 'negative' ? 1 : -1; // 1 + GH for negative FB
    const one = new Array(GH_den.length).fill(0);
    one[one.length - 1] = 1; // 1 as polynomial
    const denom_poly = polyAdd(GH_den, GH_num, sign);

    // Closed-loop TF:
    //   (this.num/this.den) / ((1 ± GH_num/GH_den))
    // = (this.num/this.den) * (GH_den / denom_poly)
    const num = polyMultiply(this.num, GH_den);
    const den = polyMultiply(this.den, denom_poly);
    return new TransferFunction(num, den);
  }

  /**
   * Convert to a human-readable string for logging, e.g. "(2s + 3)/(s^2 + 5s + 6)".
   * Purely cosmetic for the reduction log.
   *
   * @returns {string}
   */
  toString() {
    const polyToString = (p) => {
      const deg = p.length - 1;
      return p
        .map((coef, i) => {
          const power = deg - i;
          if (Math.abs(coef) < 1e-12) return null;
          const sign = coef >= 0 ? '+' : '-';
          const abs = Math.abs(coef);
          let term;
          if (power === 0) {
            term = abs.toString();
          } else if (power === 1) {
            term = abs === 1 ? 's' : `${abs}·s`;
          } else {
            term = abs === 1 ? `s^${power}` : `${abs}·s^${power}`;
          }
          return { sign, term };
        })
        .filter(Boolean)
        .map((part, idx) => {
          const s = /** @type {{sign:string, term:string}} */ (part);
          if (idx === 0) {
            return (s.sign === '-' ? '-' : '') + s.term;
          }
          return ` ${s.sign} ${s.term}`;
        })
        .join(' ') || '0';
    };

    const n = polyToString(this.num);
    const d = polyToString(this.den);
    return `(${n}) / (${d})`;
  }
}

/* ============================================================================
 * Graph Model
 * ==========================================================================*/

/**
 * @typedef {'transfer'|'sum'|'takeoff'|'input'|'output'} BlockType
 */

/**
 * @typedef {Object} Block
 * @property {string} id
 * @property {BlockType} type
 * @property {TransferFunction | null} [tf]           // for 'transfer' (and optional for takeoff)
 * @property {string} [label]                         // optional human label
 */

/**
 * @typedef {Object} Edge
 * @property {string} id
 * @property {string} from       // block id
 * @property {string} to         // block id
 * @property {'+'|'-'} [sign]    // meaning only for edges INTO a summing junction
 */

/**
 * Central graph structure for the block diagram.
 */
class BlockDiagram {
  constructor() {
    /** @type {Map<string, Block>} */
    this.blocks = new Map();
    /** @type {Map<string, Edge>} */
    this.edges = new Map();
    this._nextBlockId = 1;
    this._nextEdgeId = 1;
  }

  /**
   * @returns {string}
   * @private
   */
  _genBlockId() {
    return `B${this._nextBlockId++}`;
  }

  /**
   * @returns {string}
   * @private
   */
  _genEdgeId() {
    return `E${this._nextEdgeId++}`;
  }

  /**
   * Add a new block (node) to the diagram.
   *
   * @param {BlockType} type
   * @param {{ tf?: TransferFunction, label?: string }} [options]
   * @returns {Block}
   */
  addBlock(type, options = {}) {
    const id = this._genBlockId();
    const block = {
      id,
      type,
      tf: options.tf ?? null,
      label: options.label ?? id,
    };
    this.blocks.set(id, block);
    return block;
  }

  /**
   * Remove a block and all incident edges.
   * @param {string} blockId
   */
  removeBlock(blockId) {
    if (!this.blocks.has(blockId)) return;
    // Remove incident edges
    for (const [id, edge] of Array.from(this.edges.entries())) {
      if (edge.from === blockId || edge.to === blockId) {
        this.edges.delete(id);
      }
    }
    this.blocks.delete(blockId);
  }

  /**
   * Create a directed connection between blocks.
   *
   * @param {string} from
   * @param {string} to
   * @param {{ signIntoSum?: '+'|'-' }} [options]
   * @returns {Edge}
   */
  connectBlocks(from, to, options = {}) {
    if (!this.blocks.has(from) || !this.blocks.has(to)) {
      throw new Error('connectBlocks: invalid from/to block id');
    }
    const id = this._genEdgeId();
    /** @type {Edge} */
    const edge = {
      id,
      from,
      to,
    };
    if (options.signIntoSum) {
      edge.sign = options.signIntoSum;
    }
    this.edges.set(id, edge);
    return edge;
  }

  /**
   * Remove an edge by id.
   * @param {string} edgeId
   */
  disconnectBlocks(edgeId) {
    this.edges.delete(edgeId);
  }

  /**
   * @param {string} blockId
   * @returns {Edge[]}
   */
  getIncomingEdges(blockId) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.to === blockId) result.push(edge);
    }
    return result;
  }

  /**
   * @param {string} blockId
   * @returns {Edge[]}
   */
  getOutgoingEdges(blockId) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.from === blockId) result.push(edge);
    }
    return result;
  }

  /**
   * Return the single input block if there is one, else null.
   * @returns {Block | null}
   */
  getSingleInputBlock() {
    const inputs = Array.from(this.blocks.values()).filter((b) => b.type === 'input');
    return inputs.length === 1 ? inputs[0] : null;
  }

  /**
   * Return the single output block if there is one, else null.
   * @returns {Block | null}
   */
  getSingleOutputBlock() {
    const outputs = Array.from(this.blocks.values()).filter((b) => b.type === 'output');
    return outputs.length === 1 ? outputs[0] : null;
  }
}

/* ============================================================================
 * Reduction Pattern Detection
 * ==========================================================================*/

/**
 * @typedef {Object} SeriesPattern
 * @property {string} upstreamId
 * @property {string} downstreamId
 * @property {string} edgeId
 */

/**
 * Detect a reducible series pair: transfer block A followed by transfer block B,
 * connected by a single edge, with:
 *   - A has exactly one outgoing edge (to B)
 *   - B has exactly one incoming edge (from A)
 *
 * @param {BlockDiagram} diagram
 * @returns {SeriesPattern | null}
 */
function findSeries(diagram) {
  for (const block of diagram.blocks.values()) {
    if (block.type !== 'transfer' || !block.tf) continue;
    const outgoing = diagram.getOutgoingEdges(block.id);
    if (outgoing.length !== 1) continue;

    const edge = outgoing[0];
    const downstream = diagram.blocks.get(edge.to);
    if (!downstream || downstream.type !== 'transfer' || !downstream.tf) continue;
    const incomingToDown = diagram.getIncomingEdges(downstream.id);
    if (incomingToDown.length !== 1) continue;

    // Found a series pair
    return {
      upstreamId: block.id,
      downstreamId: downstream.id,
      edgeId: edge.id,
    };
  }
  return null;
}

/**
 * @typedef {Object} ParallelPattern
 * @property {string} inputId   // common input node
 * @property {string} outputId  // common output node
 * @property {string[]} blockIds  // transfer block ids in parallel
 */

/**
 * Detect simple parallel blocks: two or more transfer blocks that share
 * the same input and output nodes.
 *
 * Example structure:
 *   Node N_in -> G1 -> N_out
 *   Node N_in -> G2 -> N_out
 *
 * Where G1 and G2 are transfer blocks and:
 *   - each has exactly one incoming and one outgoing edge
 *
 * @param {BlockDiagram} diagram
 * @returns {ParallelPattern | null}
 */
function findParallel(diagram) {
  /** @type {Map<string, string[]>} key: `${inId}->${outId}` -> [blockId] */
  const groups = new Map();

  for (const block of diagram.blocks.values()) {
    if (block.type !== 'transfer' || !block.tf) continue;
    const incoming = diagram.getIncomingEdges(block.id);
    const outgoing = diagram.getOutgoingEdges(block.id);
    if (incoming.length !== 1 || outgoing.length !== 1) continue;
    const inNodeId = incoming[0].from;
    const outNodeId = outgoing[0].to;
    const key = `${inNodeId}->${outNodeId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block.id);
  }

  for (const [key, blockIds] of groups.entries()) {
    if (blockIds.length < 2) continue;
    const [inputId, outputId] = key.split('->');
    return { inputId, outputId, blockIds };
  }

  return null;
}

/**
 * @typedef {Object} FeedbackPattern
 * @property {string} summingId
 * @property {string[]} forwardBlockIds   // transfer blocks in forward path
 * @property {string[]} feedbackBlockIds  // transfer blocks in feedback path
 * @property {'negative'|'positive'} feedbackType
 */

/**
 * Attempt to detect a *simple* feedback loop of the form:
 *
 *   (external input) -> [sum node S] -> G_forward (one or more transfer blocks)
 *       -> ... -> Y
 *   Y -> H (zero or more transfer blocks) -> S (with + or - sign)
 *
 * Constraints:
 *   - The forward and feedback paths must be *unbranched* chains
 *     (nodes in the path have exactly 1 in and 1 out, except S and Y).
 *
 * This is intentionally conservative: it only recognises textbook-style
 * feedback; more complex patterns can be added later.
 *
 * @param {BlockDiagram} diagram
 * @returns {FeedbackPattern | null}
 */
function findFeedbackLoop(diagram) {
  const isPureChainNode = (blockId, { allowMultipleIn = false, allowMultipleOut = false } = {}) => {
    const incoming = diagram.getIncomingEdges(blockId).length;
    const outgoing = diagram.getOutgoingEdges(blockId).length;
    if (!allowMultipleIn && incoming !== 1) return false;
    if (!allowMultipleOut && outgoing !== 1) return false;
    return true;
  };

  for (const sum of diagram.blocks.values()) {
    if (sum.type !== 'sum') continue;

    const outgoingFromSum = diagram.getOutgoingEdges(sum.id);
    if (outgoingFromSum.length !== 1) continue; // simple 1-output junction

    // Forward path: sum -> ... -> Y (end node)
    /** @type {string[]} */
    const forwardBlocks = [];
    let curEdge = outgoingFromSum[0];
    let curTarget = diagram.blocks.get(curEdge.to);
    if (!curTarget) continue;

    while (curTarget.type === 'transfer' && curTarget.tf && isPureChainNode(curTarget.id)) {
      forwardBlocks.push(curTarget.id);
      const outs = diagram.getOutgoingEdges(curTarget.id);
      if (outs.length !== 1) break;
      curEdge = outs[0];
      curTarget = diagram.blocks.get(curEdge.to);
      if (!curTarget) break;
    }

    const yNode = curTarget;
    if (!yNode) continue;

    // Look for feedback edge from Y (or from transfer nodes near it) back to sum
    /** @type {string[]} */
    const feedbackBlocks = [];
    /** @type {'negative'|'positive'} */
    let feedbackType = 'negative';

    const outgoingFromY = diagram.getOutgoingEdges(yNode.id);
    for (const out of outgoingFromY) {
      if (out.to !== sum.id) continue;
      // Direct feedback from Y -> sum (H = 1)
      const sign = out.sign === '-' ? 'positive' : 'negative'; // minus at sum => negative feedback
      feedbackType = sign;
      return {
        summingId: sum.id,
        forwardBlockIds: forwardBlocks,
        feedbackBlockIds: feedbackBlocks,
        feedbackType,
      };
    }

    // Or: Y -> (feedback chain of transfer blocks) -> sum
    for (const out of outgoingFromY) {
      const firstFbNode = diagram.blocks.get(out.to);
      if (!firstFbNode || firstFbNode.type !== 'transfer' || !firstFbNode.tf) continue;

      const fbChain = [];
      let curr = firstFbNode;
      let lastEdge = null;

      while (curr.type === 'transfer' && curr.tf && isPureChainNode(curr.id)) {
        fbChain.push(curr.id);
        const outs = diagram.getOutgoingEdges(curr.id);
        if (outs.length !== 1) break;
        lastEdge = outs[0];
        const nextNode = diagram.blocks.get(lastEdge.to);
        if (!nextNode) break;
        if (nextNode.id === sum.id) {
          // Reached summing junction
          const sign = lastEdge.sign === '-' ? 'positive' : 'negative';
          feedbackType = sign;
          return {
            summingId: sum.id,
            forwardBlockIds: forwardBlocks,
            feedbackBlockIds: fbChain,
            feedbackType,
          };
        }
        curr = nextNode;
      }
    }
  }

  return null;
}

/* ============================================================================
 * Reduction Operations
 * ==========================================================================*/

/**
 * @typedef {Object} ReductionStep
 * @property {'series'|'parallel'|'feedback'|'moveSumming'|'moveTakeoff'} type
 * @property {string} description
 * @property {any} [meta]
 */

/**
 * Apply series reduction for a single series pattern:
 *   - Combine transfer functions: G_new = G1 * G2
 *   - Rewire graph: keep upstream block, delete downstream block,
 *     and reconnect outgoing edges from downstream to upstream.
 *
 * @param {BlockDiagram} diagram
 * @param {SeriesPattern} pattern
 * @param {ReductionStep[]} log
 */
function applySeriesReduction(diagram, pattern, log) {
  const upstream = diagram.blocks.get(pattern.upstreamId);
  const downstream = diagram.blocks.get(pattern.downstreamId);
  if (!upstream || !downstream || !upstream.tf || !downstream.tf) return;

  const oldG1 = upstream.tf.clone();
  const oldG2 = downstream.tf.clone();
  const combined = upstream.tf.series(downstream.tf);
  upstream.tf = combined;

  // Rewire outgoing edges of downstream to originate from upstream
  const outgoingDown = diagram.getOutgoingEdges(downstream.id);
  for (const edge of outgoingDown) {
    edge.from = upstream.id;
  }

  // Remove the intermediate edge and downstream block
  diagram.disconnectBlocks(pattern.edgeId);
  diagram.removeBlock(downstream.id);

  log.push({
    type: 'series',
    description: `Series reduction: merged ${upstream.label} and ${downstream.label} into a single block`,
    meta: {
      upstreamId: upstream.id,
      downstreamId: downstream.id,
      oldG1: oldG1.toString(),
      oldG2: oldG2.toString(),
      newG: combined.toString(),
    },
  });
}

/**
 * Apply parallel reduction:
 *   - Combine multiple transfer blocks in parallel between the same input and output nodes.
 *
 * @param {BlockDiagram} diagram
 * @param {ParallelPattern} pattern
 * @param {ReductionStep[]} log
 */
function applyParallelReduction(diagram, pattern, log) {
  if (pattern.blockIds.length < 2) return;

  const [firstId, ...restIds] = pattern.blockIds;
  const base = diagram.blocks.get(firstId);
  if (!base || !base.tf) return;
  let combined = base.tf.clone();

  /** @type {string[]} */
  const reducedBlocks = [];

  for (const id of restIds) {
    const blk = diagram.blocks.get(id);
    if (!blk || !blk.tf) continue;
    combined = combined.parallel(blk.tf, 1); // assume addition; for subtraction model negative gains in TF
    reducedBlocks.push(id);
  }

  const oldG = base.tf.toString();
  base.tf = combined;

  // Remove the now-merged parallel blocks and their incident edges (except base)
  for (const id of reducedBlocks) {
    diagram.removeBlock(id);
  }

  log.push({
    type: 'parallel',
    description: `Parallel reduction: merged ${pattern.blockIds.length} parallel blocks between ${pattern.inputId} and ${pattern.outputId}`,
    meta: {
      baseBlockId: base.id,
      mergedBlockIds: reducedBlocks,
      oldBase: oldG,
      newG: combined.toString(),
    },
  });
}

/**
 * Apply simple feedback reduction for a recognised pattern.
 *
 * Strategy:
 *   - Compute G = product of forwardBlockIds (in forward order)
 *   - Compute H = product of feedbackBlockIds (feedback path)
 *   - Compute closed-loop TF: G_cl = G.feedback(H, feedbackType)
 *   - Replace the entire loop with a single transfer block on the
 *     forward path, and remove the summing node and internal blocks.
 *
 * @param {BlockDiagram} diagram
 * @param {FeedbackPattern} pattern
 * @param {ReductionStep[]} log
 */
function applyFeedbackReduction(diagram, pattern, log) {
  if (pattern.forwardBlockIds.length === 0) return;

  // Build G from forward path
  let G = null;
  for (const id of pattern.forwardBlockIds) {
    const blk = diagram.blocks.get(id);
    if (!blk || !blk.tf) return;
    G = G ? G.series(blk.tf) : blk.tf.clone();
  }
  if (!G) return;

  // Build H from feedback path (or unity if empty)
  let H = null;
  if (pattern.feedbackBlockIds.length === 0) {
    H = TransferFunction.fromGain(1);
  } else {
    for (const id of pattern.feedbackBlockIds) {
      const blk = diagram.blocks.get(id);
      if (!blk || !blk.tf) return;
      H = H ? H.series(blk.tf) : blk.tf.clone();
    }
  }

  const closedLoop = G.feedback(H, pattern.feedbackType);

  // Choose the first forward block as the new closed-loop block
  const firstForwardId = pattern.forwardBlockIds[0];
  const firstForward = diagram.blocks.get(firstForwardId);
  if (!firstForward) return;

  const oldG = G.toString();
  const oldH = H.toString();

  firstForward.tf = closedLoop;

  // Rewire: incoming edges into summing node that are NOT part of the feedback
  // should now go into the firstForward block.
  const sumNode = diagram.blocks.get(pattern.summingId);
  if (!sumNode) return;

  const sumIncoming = diagram.getIncomingEdges(sumNode.id);
  for (const edge of sumIncoming) {
    // Skip feedback edge(s) (they end at sum and originate from within the loop)
    const isFeedbackEdge =
      pattern.feedbackBlockIds.includes(edge.from) ||
      pattern.forwardBlockIds.includes(edge.from);
    if (isFeedbackEdge) {
      diagram.disconnectBlocks(edge.id);
      continue;
    }
    // External input edge: redirect it to the first forward block
    edge.to = firstForward.id;
    delete edge.sign;
  }

  // Outgoing edge from sum node into firstForward is now obsolete
  const sumOutgoing = diagram.getOutgoingEdges(sumNode.id);
  for (const edge of sumOutgoing) {
    diagram.disconnectBlocks(edge.id);
  }

  // Remove internal feedback blocks and summing node
  for (const fbId of pattern.feedbackBlockIds) {
    diagram.removeBlock(fbId);
  }
  diagram.removeBlock(sumNode.id);

  log.push({
    type: 'feedback',
    description: `Feedback reduction at summing node ${pattern.summingId}`,
    meta: {
      summingId: pattern.summingId,
      forwardBlockIds: pattern.forwardBlockIds,
      feedbackBlockIds: pattern.feedbackBlockIds,
      feedbackType: pattern.feedbackType,
      G: oldG,
      H: oldH,
      closedLoop: closedLoop.toString(),
    },
  });
}

/* ============================================================================
 * Optional: Moving Summing / Takeoff Points (Local Transformations)
 * ==========================================================================*/

/**
 * Move a summing junction across a transfer block (basic algebraic move).
 *
 * Pattern (before):
 *   X --G--> (sum S) -- ...      or      (sum S) --G--> ...
 *
 * For now we implement a very conservative version:
 *   - Only handles sum immediately BEFORE a single transfer block (S -> G)
 *   - Duplicates G on each incoming non-feedback branch:
 *       R --->(+)---\
 *                    \ S -> G -> Y
 *       B --->(+)---/
 *     becomes:
 *       R -> G ->(+)--> Y
 *       B -> G ->(+)--> Y
 *
 * This is mainly provided as a primitive for future, more advanced
 * automated reductions.
 *
 * @param {BlockDiagram} diagram
 * @param {string} sumId
 * @param {string} blockId
 * @param {ReductionStep[]} log
 * @returns {boolean} true if a transformation was applied
 */
function moveSummingAcrossBlockForward(diagram, sumId, blockId, log) {
  const sum = diagram.blocks.get(sumId);
  const blk = diagram.blocks.get(blockId);
  if (!sum || !blk || sum.type !== 'sum' || blk.type !== 'transfer' || !blk.tf) {
    return false;
  }

  // Require S -> G with a single outgoing edge
  const sumOut = diagram.getOutgoingEdges(sum.id);
  if (sumOut.length !== 1 || sumOut[0].to !== blk.id) return false;

  const incoming = diagram.getIncomingEdges(sum.id);
  if (incoming.length < 2) return false; // nothing to gain

  // Target node after G
  const blkOut = diagram.getOutgoingEdges(blk.id);
  if (blkOut.length !== 1) return false;
  const targetAfterG = blkOut[0].to;

  // For each input into S, route it through a clone of G then into a new sum at the output side.
  const newSum = diagram.addBlock('sum', { label: `${sum.label}_moved` });

  /** @type {TransferFunction[]} */
  const originalTFs = [];

  for (const edgeIn of incoming) {
    const clonedG = diagram.addBlock('transfer', {
      tf: blk.tf.clone(),
      label: `${blk.label}_clone`,
    });
    diagram.connectBlocks(edgeIn.from, clonedG.id);
    diagram.connectBlocks(clonedG.id, newSum.id, { signIntoSum: edgeIn.sign ?? '+' });
    diagram.disconnectBlocks(edgeIn.id);
    originalTFs.push(blk.tf.clone());
  }

  // Reconnect new sum to the original downstream node
  const oldEdge = blkOut[0];
  diagram.connectBlocks(newSum.id, targetAfterG);
  diagram.disconnectBlocks(oldEdge.id);

  // Remove old sum and block
  diagram.removeBlock(sum.id);
  diagram.removeBlock(blk.id);

  log.push({
    type: 'moveSumming',
    description: `Moved summing junction ${sumId} across block ${blockId} (forward), duplicating block`,
  });

  return true;
}

/**
 * Move a takeoff (pickoff) point across a transfer block.
 *
 * Basic rule (forward move, after the block):
 *   X --G--> o----> Y       (takeoff after G)
 *             \
 *              ---> Z
 *
 * can be moved before G by inserting G on the branched path:
 *   X --G-->----> Y
 *    \
 *     G ----> Z
 *
 * Here we assume:
 *   - takeoff is modelled as a 'takeoff' block with 1 input and >=1 outputs
 *   - G is a transfer block immediately before the takeoff.
 *
 * @param {BlockDiagram} diagram
 * @param {string} takeoffId
 * @param {string} blockId
 * @param {ReductionStep[]} log
 * @returns {boolean}
 */
function moveTakeoffAcrossBlockBackward(diagram, takeoffId, blockId, log) {
  const takeoff = diagram.blocks.get(takeoffId);
  const blk = diagram.blocks.get(blockId);
  if (!takeoff || !blk || takeoff.type !== 'takeoff' || blk.type !== 'transfer' || !blk.tf) {
    return false;
  }

  // Require G -> T (block feeds takeoff)
  const incomingToTakeoff = diagram.getIncomingEdges(takeoff.id);
  if (incomingToTakeoff.length !== 1 || incomingToTakeoff[0].from !== blk.id) return false;

  // Node feeding G
  const incomingToG = diagram.getIncomingEdges(blk.id);
  if (incomingToG.length !== 1) return false;
  const sourceId = incomingToG[0].from;

  const takeoffOut = diagram.getOutgoingEdges(takeoff.id);
  if (takeoffOut.length < 2) return false; // not a real branching point

  // For each outgoing branch of the takeoff, insert a copy of G
  for (const edge of takeoffOut) {
    const destId = edge.to;
    const clonedG = diagram.addBlock('transfer', {
      tf: blk.tf.clone(),
      label: `${blk.label}_branch`,
    });
    diagram.connectBlocks(takeoff.id, clonedG.id);
    diagram.connectBlocks(clonedG.id, destId);
    diagram.disconnectBlocks(edge.id);
  }

  // Now move takeoff before G
  const edgeIntoG = incomingToG[0];
  diagram.connectBlocks(sourceId, takeoff.id);
  diagram.disconnectBlocks(edgeIntoG.id);

  // Connect original path: one branch from takeoff through original G
  diagram.connectBlocks(takeoff.id, blk.id);

  log.push({
    type: 'moveTakeoff',
    description: `Moved takeoff ${takeoffId} across block ${blockId} (backward), inserting cloned blocks on branches`,
  });

  return true;
}

/* ============================================================================
 * Top-Level Reduction Engine
 * ==========================================================================*/

/**
 * Attempt to fully reduce the diagram to a single equivalent transfer function
 * between the (single) input and (single) output block.
 *
 * This function repeatedly:
 *   - detects series, parallel, and simple feedback patterns
 *   - applies the corresponding reduction
 *   - logs each step
 *
 * @param {BlockDiagram} diagram
 * @returns {{ transferFunction: TransferFunction | null, steps: ReductionStep[] }}
 */
function reduceDiagram(diagram) {
  /** @type {ReductionStep[]} */
  const steps = [];

  let changed = true;
  let safetyCounter = 0;
  const MAX_ITER = 1000;

  while (changed && safetyCounter++ < MAX_ITER) {
    changed = false;

    const seriesPattern = findSeries(diagram);
    if (seriesPattern) {
      applySeriesReduction(diagram, seriesPattern, steps);
      changed = true;
      continue;
    }

    const parallelPattern = findParallel(diagram);
    if (parallelPattern) {
      applyParallelReduction(diagram, parallelPattern, steps);
      changed = true;
      continue;
    }

    const fbPattern = findFeedbackLoop(diagram);
    if (fbPattern) {
      applyFeedbackReduction(diagram, fbPattern, steps);
      changed = true;
      continue;
    }

    // No automatic summing/takeoff moves by default to avoid unexpected
    // graph growth. They are exposed as explicit operations instead.
  }

  const inputBlock = diagram.getSingleInputBlock();
  const outputBlock = diagram.getSingleOutputBlock();

  if (!inputBlock || !outputBlock) {
    steps.push({
      type: 'series',
      description:
        'Reduction stopped: diagram must have exactly one input and one output node to compute a single transfer function.',
    });
    return { transferFunction: null, steps };
  }

  // After structural reductions, we expect a single transfer block path
  // from input to output, with no summing nodes or loops.
  const tf = computeTransferBetween(diagram, inputBlock.id, outputBlock.id);

  if (!tf) {
    steps.push({
      type: 'series',
      description: 'Reduction stopped: could not deduce a unique transfer function from remaining structure.',
    });
  } else {
    steps.push({
      type: 'series',
      description: `Final equivalent transfer function between ${inputBlock.id} and ${outputBlock.id}: ${tf.toString()}`,
    });
  }

  return { transferFunction: tf, steps };
}

/**
 * Compute effective transfer function between two blocks assuming:
 *   - the reduced graph is feedforward-only (no loops),
 *   - all functional elements are modelled as 'transfer' blocks,
 *   - summing has been structurally eliminated by reduction.
 *
 * Implementation:
 *   - We perform a depth-first search from source to destination,
 *     aggregating the total transfer function for each distinct path,
 *     then sum paths in parallel.
 *
 * NOTE: This is only used after structural reductions have greatly
 * simplified the graph.
 *
 * @param {BlockDiagram} diagram
 * @param {string} sourceId
 * @param {string} destId
 * @returns {TransferFunction | null}
 */
function computeTransferBetween(diagram, sourceId, destId) {
  /** @type {TransferFunction[]} */
  const pathTFs = [];

  /**
   * @param {string} currentId
   * @param {TransferFunction} currentTF
   * @param {Set<string>} visited
   */
  function dfs(currentId, currentTF, visited) {
    if (visited.has(currentId)) return; // avoid accidental loops
    visited.add(currentId);

    if (currentId === destId) {
      pathTFs.push(currentTF.clone());
      visited.delete(currentId);
      return;
    }

    const outgoing = diagram.getOutgoingEdges(currentId);
    if (outgoing.length === 0) {
      visited.delete(currentId);
      return;
    }

    for (const edge of outgoing) {
      const nextBlock = diagram.blocks.get(edge.to);
      if (!nextBlock) continue;
      let nextTF = currentTF;
      if (nextBlock.type === 'transfer' && nextBlock.tf) {
        nextTF = currentTF.series(nextBlock.tf);
      }
      dfs(nextBlock.id, nextTF, visited);
    }

    visited.delete(currentId);
  }

  // Start from the input node; if it directly has a transfer block after it,
  // the DFS will incorporate that.
  dfs(sourceId, TransferFunction.fromGain(1), new Set());

  if (pathTFs.length === 0) return null;
  let combined = pathTFs[0];
  for (let i = 1; i < pathTFs.length; i++) {
    combined = combined.parallel(pathTFs[i], 1);
  }
  return combined;
}

/* ============================================================================
 * Exports (Node + Browser)
 * ==========================================================================*/

const BlockDiagramEngineExports = {
  TransferFunction,
  BlockDiagram,
  reduceDiagram,

  // Expose low-level operations in case backend or tests need them
  polyMultiply,
  polyAdd,
  normaliseRational,

  // Pattern detection helpers (useful for debugging / UI overlays)
  findSeries,
  findParallel,
  findFeedbackLoop,

  // Optional structural moves
  moveSummingAcrossBlockForward,
  moveTakeoffAcrossBlockBackward,
};

// CommonJS / Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockDiagramEngineExports;
}

// Browser global (for index.html usage)
if (typeof window !== 'undefined') {
  window.BlockDiagramEngine = BlockDiagramEngineExports;
}

