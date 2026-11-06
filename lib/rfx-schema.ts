import { z } from "zod";

/** Runtime check for the Rfx shape in rfx-types.ts; safe to import on client and server. */
export const RfxSchema = z
  .object({
    rfxId: z.string().min(1),
    title: z.string().min(1),
    buyer: z.string(),
    issuedOn: z.string(),
    responseDueBy: z.string(),
    deliveryLocation: z.string(),
    items: z
      .array(
        z.object({
          itemCode: z.string().trim().min(1),
          description: z.string().trim().min(1),
          spec: z.string(),
          quantity: z.number().int().positive(),
          unit: z.string().min(1),
        }),
      )
      .min(1),
  })
  .refine((r) => new Set(r.items.map((i) => i.itemCode)).size === r.items.length, { message: "Item codes must be unique" });
