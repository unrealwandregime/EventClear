import type { TransactionStage } from "../../lib/types";

export function TransactionTimeline({ stages, chainId }: {
  stages: TransactionStage[];
  chainId: number;
}) {
  return (
    <div className="timeline">
      {stages.length === 0 && <small>No transaction has been requested.</small>}
      {stages.map((stage) => (
        <div className="timeline-row" key={stage.action}>
          <span>{stage.action.replaceAll("_", " ").toLowerCase()}</span>
          <em>{stage.status}</em>
          {stage.hash && (
            chainId === 137
              ? <a href={`https://polygonscan.com/tx/${stage.hash}`} target="_blank" rel="noreferrer">{stage.hash.slice(0, 10)}…</a>
              : <code>{stage.hash.slice(0, 12)}…</code>
          )}
        </div>
      ))}
    </div>
  );
}
