import { Link } from "react-router-dom";

export function EnvIssuesBanner({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
      <div className="text-sm font-semibold">Configuration issue</div>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {issues.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="mt-2 text-sm">
        <Link to="/settings" className="underline underline-offset-4">
          Open settings
        </Link>
      </div>
    </div>
  );
}

