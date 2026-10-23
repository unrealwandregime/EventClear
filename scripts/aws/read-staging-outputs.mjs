import { aws, requireEnv, isMain } from './common.mjs';
export const requiredOutputs=['ClusterArn','VpcId','TaskSubnets','WebSecurityGroup','ApiSecurityGroup','SolverSecurityGroup','IndexerSecurityGroup','MigrationSecurityGroup','ExecutionRoleArn','ApiTaskRoleArn','WebTaskRoleArn','SolverTaskRoleArn','IndexerTaskRoleArn','MigrationTaskRoleArn','ArtifactBucket','RiskKeyArn','DatabaseSecretArn','RuntimeSecretArn','RedisEndpoint','AlertTopicArn','WebUrl','ApiUrl','ApiTargetGroupArn','WebTargetGroupArn','ServiceNamespaceId','ServiceNamespaceName','HostedZoneId','EcrPrefix'];
export function validateOutputs(stack) {
 if(!['CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus)) throw Error('STACK_NOT_READY');
 const o=Object.fromEntries((stack.Outputs??[]).map(x=>[x.OutputKey,x.OutputValue]));
 for(const k of requiredOutputs) if(!o[k]||/\$\{|placeholder|\.invalid/.test(o[k])) throw Error(`STACK_OUTPUT_MISSING_OR_INVALID:${k}`);
 for(const k of ['WebUrl','ApiUrl']) if(new URL(o[k]).protocol!=='https:') throw Error('HTTPS_REQUIRED');
 return o;
}
export function readOutputs() {
 requireEnv(['STAGING_STACK_NAME','AWS_REGION']);
 return validateOutputs(aws(['cloudformation','describe-stacks','--stack-name',process.env.STAGING_STACK_NAME]).Stacks[0]);
}
if(isMain(import.meta.url)) console.log(JSON.stringify(readOutputs(),null,2));
