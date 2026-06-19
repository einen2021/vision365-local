"use client"

import { usePathname } from "next/navigation"
import { BookOpen } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FaqHelpButton } from "@/components/faq-help-button"
import { getPageGuideRoot, normalizePath } from "@/config/faq-registry"
import Link from "next/link"
import { faqRoute } from "@/config/role-routes"

/**
 * Page-level help strip — pass `pagePath` or auto-detect from URL.
 */
export function PageHelpBanner({ pagePath, className }) {
  const pathname = usePathname()
  const path = normalizePath(pagePath || pathname)
  const guide = getPageGuideRoot(path)

  if (!guide) return null

  return (
    <Alert className={className}>
      <BookOpen className="h-4 w-4" />
      <div className="flex flex-1 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <AlertTitle className="flex items-center gap-1 text-sm mb-1">
            How to use this page
            <FaqHelpButton articleId={guide.pageId} />
          </AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {guide.summary}
          </AlertDescription>
        </div>
        <Link
          href={`${faqRoute}#${guide.pageId}`}
          className="text-xs font-medium text-primary hover:underline shrink-0 whitespace-nowrap"
        >
          All guides
        </Link>
      </div>
    </Alert>
  )
}
