# AWS external staging setup

Status: **NOT PROVISIONED**

AWS is the selected provider because one account can supply ECS/Fargate, RDS
PostgreSQL, ElastiCache Redis, S3 versioning and encryption, KMS signing,
CloudWatch logs/metrics/alarms, Secrets Manager, ACM, Route 53 and rollback.
These commands are intentionally parameterized: they create no resource until
an authenticated operator supplies the checklist values.

## Authentication and safety preflight

```bash
aws sts get-caller-identity
aws configure get region
test "$STAGING_CHAIN_ID" != "137"
git diff --exit-code
git branch --show-current
```

Use GitHub OIDC rather than long-lived AWS access keys. The deploy role trust
policy must restrict `sub` to
`repo:unrealwandregime/EventClear:environment:staging`.

## Provider resources

Create one isolated VPC with public load-balancer subnets and private
application/data subnets, then provision:

```bash
aws rds create-db-instance --db-instance-identifier eventclear-staging-postgres \
  --engine postgres --db-instance-class db.t4g.micro --allocated-storage 20 \
  --storage-encrypted --backup-retention-period 7 \
  --no-publicly-accessible --vpc-security-group-ids "$STAGING_DB_SG" \
  --db-subnet-group-name "$STAGING_DB_SUBNET_GROUP" \
  --master-username eventclear_admin --manage-master-user-password

aws elasticache create-replication-group \
  --replication-group-id eventclear-staging-redis \
  --replication-group-description "EventClear staging rate limits" \
  --engine redis --transit-encryption-enabled --at-rest-encryption-enabled \
  --auth-token "$REDIS_AUTH_TOKEN" --automatic-failover-enabled \
  --cache-node-type cache.t4g.micro --num-cache-clusters 2 \
  --cache-subnet-group-name "$STAGING_CACHE_SUBNET_GROUP" \
  --security-group-ids "$STAGING_REDIS_SG"

if [ "$AWS_REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$STAGING_ARTIFACT_BUCKET" --region "$AWS_REGION"
else
  aws s3api create-bucket --bucket "$STAGING_ARTIFACT_BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"
fi
aws s3api put-public-access-block --bucket "$STAGING_ARTIFACT_BUCKET" \
  --public-access-block-configuration \
BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$STAGING_ARTIFACT_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STAGING_ARTIFACT_BUCKET" \
  --server-side-encryption-configuration \
'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY \
  --description "EventClear staging quote signer"
aws logs create-log-group --log-group-name /eventclear/staging
aws sns get-topic-attributes --topic-arn "$STAGING_ALERT_TOPIC_ARN"

for repository in web api solver indexer migration; do
  aws ecr create-repository \
    --repository-name "eventclear-staging-$repository" \
    --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true
done
```

Apply all SQL files in `infrastructure/docker/postgres/migrations` in numeric
order through a one-off private ECS task. Deploy `web`, `api`, `solver`, and
`indexer` as separate ECS services tagged with the full Git SHA. The API and
indexer task roles may read only their scoped Secrets Manager entries; only the
API role may sign through the staging KMS key and access the private artifact
bucket.

The persistent remote Anvil service must use an encrypted EFS access point,
explicit non-137 chain ID, authenticated ingress, primary and fallback HTTPS
routes, and regular EFS backups. If an approved public testnet is selected,
omit Anvil/EFS and record both independent RPC providers.

## Images and deployment

```bash
export IMAGE_TAG="$(git rev-parse HEAD)"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
docker build -f infrastructure/docker/web.Dockerfile \
  -t "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/eventclear-staging-web:$IMAGE_TAG" .
docker build -f infrastructure/docker/api.Dockerfile \
  -t "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/eventclear-staging-api:$IMAGE_TAG" .
docker build -f infrastructure/docker/python.Dockerfile \
  -t "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/eventclear-staging-solver:$IMAGE_TAG" .
docker build -f infrastructure/docker/indexer.Dockerfile \
  -t "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/eventclear-staging-indexer:$IMAGE_TAG" .
```

After pushing all application and migration images, register task-definition revisions pinned to
their image digests, run migrations, and update services with:

```bash
aws ecs update-service --cluster eventclear-staging \
  --service eventclear-staging-api --task-definition "$API_TASK_DEFINITION" \
  --force-new-deployment
aws ecs wait services-stable --cluster eventclear-staging \
  --services eventclear-staging-web eventclear-staging-api \
  eventclear-staging-solver eventclear-staging-indexer
```

Rollback is an explicit update to the previous immutable task-definition
revision followed by `aws ecs wait services-stable`. Database migrations must
be backward-compatible with the previous application revision.

No command in this runbook targets Polygon mainnet or activates public capital.
