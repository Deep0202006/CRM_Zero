const repository = "Deep0202006/CRM_Zero";
const repositoryUri = `https://github.com/${repository}`;
const workflowPath = ".github/workflows/product-verification.yml";

const requiredEnvironment = (environment) => {
  if (environment.GITHUB_ACTIONS !== "true") throw new Error("ATTESTATION_REQUIRED:GITHUB_ACTIONS");
  if (environment.GITHUB_REPOSITORY !== repository) throw new Error("ATTESTATION_IDENTITY_MISMATCH:repository");
  for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_REF"])
    if (!environment[key]) throw new Error(`ATTESTATION_IDENTITY_MISSING:${key}`);
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA)) throw new Error("ATTESTATION_IDENTITY_MISMATCH:GITHUB_SHA");
};

export const parseVerifiedAttestation = ({ output, evidenceSha256, environment }) => {
  requiredEnvironment(environment);
  let rows;
  try { rows = JSON.parse(output); } catch { throw new Error("ATTESTATION_VERIFICATION_OUTPUT_INVALID"); }
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("ATTESTATION_VERIFICATION_RESULT_INVALID");
  const verification = rows[0]?.verificationResult, certificate = verification?.signature?.certificate;
  if (!certificate || !Array.isArray(verification.verifiedTimestamps) || !verification.statement) throw new Error("ATTESTATION_CERTIFICATE_FIELDS_MISSING");
  const workflowUri = `${repositoryUri}/${workflowPath}@${environment.GITHUB_REF}`;
  const invocationUri = `${repositoryUri}/actions/runs/${environment.GITHUB_RUN_ID}/attempts/${environment.GITHUB_RUN_ATTEMPT}`;
  const exact = {
    issuer: "https://token.actions.githubusercontent.com",
    githubWorkflowRepository: repository,
    githubWorkflowSHA: environment.GITHUB_SHA,
    githubWorkflowRef: environment.GITHUB_REF,
    buildSignerURI: workflowUri,
    buildSignerDigest: environment.GITHUB_SHA,
    buildConfigURI: workflowUri,
    buildConfigDigest: environment.GITHUB_SHA,
    subjectAlternativeName: workflowUri,
    sourceRepositoryURI: repositoryUri,
    sourceRepositoryOwnerURI: "https://github.com/Deep0202006",
    sourceRepositoryDigest: environment.GITHUB_SHA,
    sourceRepositoryRef: environment.GITHUB_REF,
    runInvocationURI: invocationUri,
    runnerEnvironment: "github-hosted",
  };
  for (const [key, expected] of Object.entries(exact))
    if (certificate[key] !== expected) throw new Error(`ATTESTATION_CERTIFICATE_MISMATCH:${key}`);
  if (environment.GITHUB_EVENT_NAME && certificate.githubWorkflowTrigger !== environment.GITHUB_EVENT_NAME) throw new Error("ATTESTATION_CERTIFICATE_MISMATCH:githubWorkflowTrigger");
  if (!verification.verifiedTimestamps.length || verification.verifiedTimestamps.some((item) => !item?.timestamp || !Number.isFinite(Date.parse(item.timestamp)))) throw new Error("ATTESTATION_VERIFIED_TIMESTAMP_MISSING");
  const subjects = verification.statement.subject;
  if (!Array.isArray(subjects) || subjects.filter((subject) => subject?.digest?.sha256 === evidenceSha256).length !== 1) throw new Error("ATTESTATION_SUBJECT_DIGEST_MISMATCH");
  return { evidenceSha256, repository, workflowPath, invocationUri, verifiedTimestamps: verification.verifiedTimestamps.map((item) => item.timestamp) };
};
