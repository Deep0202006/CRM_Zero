import { createPipelineServerContext, readAuthorizedPipeline } from "../server";

export async function GET(request: Request) {
  const context = await createPipelineServerContext(request);
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  try {
    return Response.json({ leads: await readAuthorizedPipeline(context), segments: context.segments });
  } catch {
    return Response.json({ code: "PIPELINE_READ_FAILED" }, { status: 502 });
  }
}
