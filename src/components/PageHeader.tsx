import { ImgReveal } from "./ui/img-reveal";

export function PageHeader({
  heading,
  subtitle,
}: {
  heading: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-7 flex flex-col items-center justify-center gap-2.5 text-center">
      <div className="flex items-center justify-center gap-3">
        <ImgReveal
          src="/manifold-icon-128.png"
          alt="Manifold logo"
          className="size-9 rounded-xl object-contain ring-1 ring-border/60"
        />
        <div className="app-title">{heading}</div>
      </div>
      {subtitle ? (
        <div className="app-subtitle max-w-md text-balance">{subtitle}</div>
      ) : null}
    </div>
  );
}
