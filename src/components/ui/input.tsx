// Adapted from https://ascii-cn.kdawg.dev/r/input.json
import type { ComponentProps } from "react";
export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={`h-9 w-full min-w-0 rounded-none border border-[#79bdff] bg-black px-3 font-mono text-base text-[#e8e8e5] placeholder:text-[#929da7] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[#79bdff] disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
