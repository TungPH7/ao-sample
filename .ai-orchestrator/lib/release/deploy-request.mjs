// A deployment request (release-workflow spec 2.8, 2.9; the form the deployer reads, T8): a deployment of one commit to
// one environment, made with your gh login. GitHub records the login of the token that creates it, and the deployer
// takes a request only from AO_APPROVERS, so this is a gate ⑤ an agent cannot pass as you.
import { ENVIRONMENTS } from './targets.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/;

// github: a writing client of your gh login. Resolves the id of the deployment.
export async function requestDeploy(github, { sha, environment, rollback }) {
  if (!FULL_SHA.test(sha ?? '')) throw new Error(`${JSON.stringify(sha)} is not a full commit hash`);
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`${JSON.stringify(environment)} is not an environment of the kit`);
  const { id } = await github.request('POST', '/deployments', undefined, {
    ref: sha,
    environment,
    auto_merge: false,
    required_contexts: [],
    payload: { ao: 'request', rollback },
    description: `ao-step: ${rollback ? 'rollback' : 'request'}`,
    production_environment: environment === 'production',
    transient_environment: false,
  });
  return id;
}
