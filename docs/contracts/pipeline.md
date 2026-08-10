# Pipeline Contract

## CURRENT

Pipeline stages are centralized in `src/lib/pipelineStages.ts`; services and exports consume the shared stage semantics.

## INVARIANT

Stage identities and existing transition semantics remain stable. Unknown data is preserved, not coerced into a guessed stage.

## KNOWN DEBT

Historical pipeline migrations and component consumers widen the change surface.

Primary tests: `pipelineStages` and pipeline reliability documentation.
