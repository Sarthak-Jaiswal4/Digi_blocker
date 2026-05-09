const { z } = require("zod");

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

module.exports = { FinalSchema };