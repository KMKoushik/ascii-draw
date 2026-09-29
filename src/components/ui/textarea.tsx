// Adapted from https://ascii-cn.kdawg.dev/r/textarea.json
import type { ComponentProps } from "react";
export function Textarea({
  className = "",
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={`min-h-24 w-full rounded-none border border-[#79bdff] bg-black p-3 font-mono text-base text-[#e8e8e5] placeholder:text-[#929da7] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[#79bdff] disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
