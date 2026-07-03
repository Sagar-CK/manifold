export function PageHeader({ heading }: { heading: string }) {
  return (
    <div className="mb-6 flex flex-col items-center justify-center gap-2 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <img
          src="/manifold-icon-128.png"
          alt="Manifold Logo"
          loading="eager"
          decoding="sync"
          className="size-7 object-contain"
        />
        <div className="app-title">{heading}</div>
      </div>
    </div>
  );
}
