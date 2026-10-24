// This adapter only redeploys an EXISTING, explicitly verified free Render service.
// It never creates resources, changes plans or sends a billing API request.
export async function redeploy(commitId) {
  if (
    process.env.PROTOTYPE_MAX_MONTHLY_COST_USD !== "0" ||
    !process.env.RENDER_SERVICE_ID ||
    !process.env.RENDER_API_KEY
  )
    throw Error("FREE_HOST_REDEPLOY_CREDENTIALS_REQUIRED");
  const id = process.env.RENDER_SERVICE_ID;
  if (!/^srv-[a-z0-9]+$/.test(id)) throw Error("HOST_SERVICE_ID_INVALID");
  async function api(path, body) {
    const response = await fetch(
      `https://api.render.com/v1/services/${id}${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${process.env.RENDER_API_KEY}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw Error(`FREE_HOST_API_REJECTED:${response.status}`);
    return response.json();
  }
  const service = await api("");
  if (service.serviceDetails?.plan !== "free" || service.type !== "web_service")
    throw Error("VERIFIED_FREE_WEB_SERVICE_REQUIRED");
  if (!/^[0-9a-f]{40}$/.test(commitId ?? ""))
    throw Error("IMMUTABLE_COMMIT_REQUIRED");
  const deployment = await api("/deploys", {
    clearCache: "do_not_clear",
    ...(commitId ? { commitId } : {}),
  });
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    const state = await api(`/deploys/${deployment.id}`);
    if (state.status === "live") {
      if (state.commit?.id !== commitId) throw Error("HOST_COMMIT_MISMATCH");
      return { deploymentId: deployment.id, gitSha: state.commit.id };
    }
    if (
      ["build_failed", "update_failed", "canceled", "deactivated"].includes(
        state.status,
      )
    )
      throw Error("FREE_HOST_DEPLOYMENT_FAILED");
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw Error("FREE_HOST_DEPLOYMENT_TIMEOUT");
}
