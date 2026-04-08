import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

type SearchNoResultsProps =
  | { variant: "tag-filters" }
  | { variant: "query"; query: string };

/**
 * Shared empty state when search / tag browse returns no files.
 */
export function SearchNoResults(props: SearchNoResultsProps) {
  const detail =
    props.variant === "tag-filters"
      ? "Try turning off some tag filters."
      : `Nothing matched “${props.query.trim()}”.`;

  return (
    <Empty className="min-h-[15rem] border-border/60 bg-muted/10 py-16">
      <EmptyHeader>
        <EmptyTitle>No matching files</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
