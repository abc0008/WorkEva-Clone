import WorkEvaApp from "@/components/WorkEvaApp";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (
    ![
      "reviews",
      "documents",
      "dashboard",
      "tasks",
      "runs",
      "designer",
      "admin",
    ].includes(view)
  )
    notFound();
  return <WorkEvaApp view={view} />;
}
