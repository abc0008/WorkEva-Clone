import WorkEvaApp from "@/components/WorkEvaApp";
import { notFound } from "next/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{
    assignmentId?: string;
    taskId?: string;
    issueId?: string;
  }>;
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
      "issues",
      "notifications",
    ].includes(view)
  )
    notFound();
  const query = await searchParams;
  return (
    <WorkEvaApp
      view={view}
      assignmentId={query.assignmentId}
      taskId={query.taskId}
      issueId={query.issueId}
    />
  );
}
