import { forwardRef, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";

export const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean; replace?: boolean; scroll?: boolean }>(function Link({ prefetch: _prefetch, replace: _replace, scroll: _scroll, ...props }, ref) { return <a ref={ref} {...props}/>; });
export function Image({ src, alt, fill, priority, unoptimized: _unoptimized, quality: _quality, loader: _loader, sizes, style, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & { src: string | { src: string }; alt: string; fill?: boolean; priority?: boolean; unoptimized?: boolean; quality?: number; loader?: unknown }) {
  return <img {...props} src={typeof src === "string" ? src : src.src} alt={alt} sizes={sizes} loading={priority ? "eager" : props.loading || "lazy"} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style}/>;
}
/** WeChat's account-link JS SDK only runs in its own WebView, never Electron. */
export function Script({ src }: { src?: string; [key: string]: unknown }) {
  if (src !== "https://res.wx.qq.com/open/js/jweixin-1.6.0.js") throw new Error("桌面应用不加载外部脚本。");
  return null;
}
