import assert from "node:assert/strict";
import { aws } from "./common.mjs";
export async function probeRedisFailure(o) {
  const service = `${process.env.STAGING_STACK_NAME}-api`;
  const arn = aws([
    "ecs",
    "describe-services",
    "--cluster",
    o.ClusterArn,
    "--services",
    service,
  ]).services[0].taskDefinition;
  const original = aws([
    "ecs",
    "describe-task-definition",
    "--task-definition",
    arn,
  ]).taskDefinition;
  const keys = [
    "family",
    "taskRoleArn",
    "executionRoleArn",
    "networkMode",
    "containerDefinitions",
    "volumes",
    "placementConstraints",
    "requiresCompatibilities",
    "cpu",
    "memory",
    "runtimePlatform",
    "ephemeralStorage",
  ];
  const definition = Object.fromEntries(
    keys.filter((k) => original[k] !== undefined).map((k) => [k, original[k]]),
  );
  definition.family = `${process.env.STAGING_STACK_NAME}-redis-probe`;
  const container = definition.containerDefinitions[0];
  container.secrets = container.secrets.filter((s) => s.name !== "REDIS_URL");
  container.environment = container.environment.filter(
    (e) => e.name !== "REDIS_URL",
  );
  container.environment.push({
    name: "REDIS_URL",
    value: "rediss://127.0.0.1:1/0?socket_connect_timeout=2",
  });
  const probe = aws(
    [
      "ecs",
      "register-task-definition",
      "--cli-input-json",
      "file:///dev/stdin",
    ],
    definition,
  ).taskDefinition.taskDefinitionArn;
  try {
    const result = aws(
      ["ecs", "run-task", "--cli-input-json", "file:///dev/stdin"],
      {
        cluster: o.ClusterArn,
        launchType: "FARGATE",
        taskDefinition: probe,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: o.TaskSubnets.split(","),
            securityGroups: [o.ApiSecurityGroup],
            assignPublicIp: "ENABLED",
          },
        },
      },
    );
    assert.equal(result.failures?.length ?? 0, 0);
    const task = result.tasks[0].taskArn;
    aws([
      "ecs",
      "wait",
      "tasks-stopped",
      "--cluster",
      o.ClusterArn,
      "--tasks",
      task,
    ]);
    const stopped = aws([
      "ecs",
      "describe-tasks",
      "--cluster",
      o.ClusterArn,
      "--tasks",
      task,
    ]).tasks[0];
    assert.notEqual(stopped.containers[0].exitCode, 0);
    const stream = `ecs/api/${task.split("/").at(-1)}`;
    let confirmed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const entries =
        aws([
          "logs",
          "filter-log-events",
          "--log-group-name",
          `/eventclear/${process.env.STAGING_STACK_NAME}/api`,
          "--log-stream-names",
          stream,
        ]).events ?? [];
      if (
        entries.some((e) =>
          e.message.includes("REDIS_RATE_LIMITER_UNAVAILABLE"),
        )
      ) {
        confirmed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(
      confirmed,
      "probe must fail specifically because Redis is unavailable",
    );
    return {
      status: "fail-closed verified",
      task,
      exitCode: stopped.containers[0].exitCode,
    };
  } finally {
    aws(["ecs", "deregister-task-definition", "--task-definition", probe]);
  }
}
