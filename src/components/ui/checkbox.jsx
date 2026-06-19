"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, disabled, id: idProp, ...props }, ref) => {
  const autoId = React.useId()
  const id = idProp || autoId

  const handleChange = (e) => {
    onCheckedChange?.(e.target.checked)
  }

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        id={id}
        checked={checked || false}
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
        role="checkbox"
        aria-checked={checked || false}
        {...props}
      />
      <label
        htmlFor={id}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 border border-primary rounded-sm bg-background ring-offset-background cursor-pointer items-center justify-center",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          checked && "bg-primary text-primary-foreground",
          className
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </label>
    </div>
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
