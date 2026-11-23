import { Card, PageHeader } from "@/components/ui";
import { VendorForm } from "@/components/vendor-form";
import { requireWorkspace } from "@/lib/auth";
import { loadLookups } from "@/lib/data";

export const metadata = { title: "Add vendor" };

export default async function NewVendor() {
  const { weddingId } = await requireWorkspace({ write: true });
  const l = await loadLookups(weddingId);
  return (
    <>
      <PageHeader folio="III · Vendors" title="Add a vendor" lede="E.g. a photographer charging ₦500,000: ₦200,000 now, ₦150,000 next month, ₦150,000 a week before the wedding." />
      <Card className="max-w-3xl"><VendorForm cats={l.categories} evs={l.events} /></Card>
    </>
  );
}
