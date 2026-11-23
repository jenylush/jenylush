import { CampaignForm } from "@/components/campaign-form";
import { Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { loadLookups } from "@/lib/data";

export const metadata = { title: "New Aso Ebi campaign" };

export default async function NewCampaign() {
  const { weddingId } = await requireWorkspace({ write: true });
  const l = await loadLookups(weddingId);
  return (
    <>
      <PageHeader folio="VII · Aso Ebi Manager" title="New Aso Ebi campaign" lede="Next you'll add packages (e.g. Female ₦85,000 · Male ₦65,000 · Couple ₦140,000), upload fabric photos, and publish your link." />
      <Card className="max-w-3xl"><CampaignForm evs={l.events} /></Card>
    </>
  );
}
