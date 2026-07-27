import { BundleDetail } from "../../components/bundles/BundleDetail";
import Link from "next/link";

export default async function BundlePage({
  params,
}: {
  params: Promise<{ bundleId: string }>;
}) {
  const { bundleId } = await params;
  return (
    <main className="detail-shell">
      <Link className="back-link" href="/">← EventClear protocol</Link>
      <p className="eyebrow">Indexed bundle detail</p>
      <h1>{bundleId}</h1>
      <BundleDetail bundleId={bundleId} />
    </main>
  );
}
