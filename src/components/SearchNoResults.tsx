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
    <div className="app-muted text-center">
      <p>No matching files.</p>
      <p className="mt-1">{detail}</p>
    </div>
  );
}
