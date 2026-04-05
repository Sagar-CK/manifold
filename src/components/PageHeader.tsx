import manifoldLogo from "../assets/manifold.png";

export function PageHeader({
  heading,
  subtitle,
}: {
  heading: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 mb-6">
      <div className="flex items-center justify-center gap-3">
        <img
          src={manifoldLogo}
          alt="Manifold logo"
          className="h-9 w-9 rounded-lg object-contain "
        />
        <div className="app-title">{heading}</div>
      </div>
      {subtitle ? <div className="app-subtitle">{subtitle}</div> : null}
    </div>
  );
}
