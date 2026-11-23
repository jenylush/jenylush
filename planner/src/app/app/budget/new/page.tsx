import { Card, PageHeader } from "@/components/ui";
import { ExpenseForm } from "@/components/forms";
import { requireWorkspace } from "@/lib/auth";
import { loadLookups } from "@/lib/data";

export const metadata = { title: "New expense" };

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ vendor?: string; category?: string }> }) {
  const sp = await searchParams;
  const { weddingId } = await requireWorkspace({ write: true });
  const lookups = await loadLookups(weddingId);
  return (
    <>
      <PageHeader folio="II · Budget & Expenses" title="New expense" lede="After saving you can split it into instalments, record payments and attach receipts." />
      <Card className="max-w-3xl"><ExpenseForm lookups={lookups} defaults={{ vendorId: sp.vendor, categoryId: sp.category }} /></Card>
    </>
  );
}
