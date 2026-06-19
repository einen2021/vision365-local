"use client"

import { FaqHelpButton } from "@/components/faq-help-button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Form label with (i) help for a field article id (`sectionId--field--fieldKey`).
 */
export function HelpLabel({ htmlFor, children, articleId, className, required }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Label htmlFor={htmlFor} className="mb-0">
        {children}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {articleId ? <FaqHelpButton articleId={articleId} size="sm" /> : null}
    </div>
  )
}
