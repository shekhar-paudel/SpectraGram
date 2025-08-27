import JobQueueTable from "./_components/queue";
export default function Page() {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <JobQueueTable />
    </div>
  );
}
