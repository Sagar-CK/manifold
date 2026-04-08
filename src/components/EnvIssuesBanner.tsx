import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function EnvIssuesBanner({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <Alert className="mb-4 rounded-xl border-border/70 bg-muted/15">
      <AlertTitle>Configuration issue</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5">
          {issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="mt-3">
          <Link to="/settings" className="underline underline-offset-4">
            Open settings
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
