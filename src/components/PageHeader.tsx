export function PageHeader({
  heading,
  subtitle,
}: {
  heading: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 mb-6">
      <div className="flex items-center justify-center gap-3">
        <img
          src="/src/assets/manifold.png"
          alt="Manifold logo"
          className="h-9 w-9 rounded-lg object-contain "
        />
        <div className="text-2xl font-semibold leading-none">{heading}</div>
      </div>
      <div className="text-xs text-black/60">{subtitle}</div>
    </div>
  );
}
