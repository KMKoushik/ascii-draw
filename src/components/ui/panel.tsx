// Adapted from https://ascii.kdawg.dev/r/panel.json
import type { ComponentProps, ReactNode } from "react";
export function Panel({
  title,
  tone = "muted",
  children,
  className = "",
  ...props
}: Omit<ComponentProps<"fieldset">, "title"> & {
  title?: ReactNode;
  tone?: "muted" | "blue" | "yellow";
}) {
  const color = {
    muted: "border-[#64717c]",
    blue: "border-[#79bdff]",
    yellow: "border-[#ffd15b]",
  }[tone];
  return (
    <fieldset
      className={`min-w-0 border bg-black p-6 font-mono text-[#e8e8e5] ${color} ${className}`}
      {...props}
    >
      {title && (
        <legend
          className={`mx-auto px-3 text-sm ${tone === "yellow" ? "text-[#ffd15b]" : tone === "blue" ? "text-[#79bdff]" : "text-[#929da7]"}`}
        >
          {title}
        </legend>
      )}
      {children}
    </fieldset>
  );
}
