import { z } from "zod";

export const canonicalErpIdSchema = z.guid();
export const optionalCanonicalErpIdSchema = z.union([canonicalErpIdSchema, z.literal("")]);
