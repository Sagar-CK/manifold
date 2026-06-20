import * as React from "react";
import { cn } from "@/lib/utils";

export type ImgRevealProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "onLoad"
> & {
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
};

/**
 * When the image finishes loading, fades in through a short blur (see transitions-dev tokens).
 */
function ImgReveal({
  className,
  onLoad,
  src,
  alt = "",
  ...props
}: ImgRevealProps) {
  const ref = React.useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  const decorative = alt.trim() === "";

  React.useEffect(() => {
    setLoaded(false);
  }, [src]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    onLoad?.(e);
  };

  return (
    <img
      ref={ref}
      src={src}
      alt={decorative ? "" : alt}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        "t-img-reveal",
        loaded && "t-img-reveal--loaded",
        className,
      )}
      onLoad={handleLoad}
      {...props}
    />
  );
}

export { ImgReveal };
