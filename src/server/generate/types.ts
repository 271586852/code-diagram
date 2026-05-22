import { z } from "zod";

export const generateRequestSchema = z
  .object({
    username: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    local_path: z.string().min(1).optional(),
    api_key: z.string().min(1).optional(),
    github_pat: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.local_path || (value.username && value.repo)), {
    message: "Provide either local_path or username/repo.",
  });

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export function sseMessage(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
