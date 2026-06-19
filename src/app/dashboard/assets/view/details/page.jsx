"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Loader2, ArrowLeft, Clock3, Maximize2, Package } from "lucide-react"
import { db } from "@/config/firebase"
import { doc, getDoc } from "firebase/firestore"

const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

function AssetDetailsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [asset, setAsset] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState("")
  const [historyImageLightbox, setHistoryImageLightbox] = useState(null)

  const building = searchParams.get("building") || ""
  const categoryKey = searchParams.get("categoryKey") || ""
  const buildingAssetID = searchParams.get("buildingAssetID") || ""

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const loadAssetAndHistory = async () => {
      if (!building || !categoryKey || !buildingAssetID) {
        setError("Missing required asset details in URL")
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError("")

      try {
        const assetRef = doc(db, building, "asset", categoryKey, buildingAssetID)
        const assetSnap = await getDoc(assetRef)

        if (!assetSnap.exists()) {
          setError("Asset not found")
          setAsset(null)
          setHistory([])
          return
        }

        const assetData = {
          id: assetSnap.id,
          ...assetSnap.data(),
        }
        setAsset(assetData)

        const historyRef = doc(db, building, "assetHistory", categoryKey, buildingAssetID)
        const historySnap = await getDoc(historyRef)
        const historyData = historySnap.exists() ? historySnap.data() : {}
        const historyArray = Array.isArray(historyData.history) ? historyData.history : []

        historyArray.sort((a, b) => {
          const aDate = a?.date ? new Date(a.date).getTime() : 0
          const bDate = b?.date ? new Date(b.date).getTime() : 0
          return bDate - aDate
        })
        setHistory(historyArray)
      } catch (err) {
        console.error("Error loading asset details/history:", err)
        setError("Failed to load asset details")
      } finally {
        setIsLoading(false)
      }
    }

    if (mounted) {
      loadAssetAndHistory()
    }
  }, [mounted, building, categoryKey, buildingAssetID])

  if (!mounted) return null

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-8">
            <SidebarTrigger className="-ml-1" />
            <ClientModeToggle />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard/assets/view">View Assets</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Asset Details</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight">Asset Details</h1>
              <p className="text-muted-foreground">View full asset information and history</p>
            </div>
            <Button variant="outline" onClick={() => router.push("/dashboard/assets/view")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Assets
            </Button>
          </div>

          {isLoading && (
            <Card>
              <CardContent className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading asset details...
              </CardContent>
            </Card>
          )}

          {!isLoading && error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && asset && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Asset Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {asset.image && (
                    <div>
                      <img
                        src={asset.image}
                        alt={asset.assetName || "Asset"}
                        className="max-h-72 rounded-md border object-contain"
                      />
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(asset).map(([key, value]) => {
                      if (value === undefined || value === null || typeof value === "object") return null
                      return (
                        <div key={key} className="rounded-md border p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{key}</p>
                          <p className="text-sm font-medium break-words">{String(value)}</p>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="h-5 w-5" />
                    Asset History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Dialog
                    open={!!historyImageLightbox}
                    onOpenChange={(open) => {
                      if (!open) setHistoryImageLightbox(null)
                    }}
                  >
                    <DialogContent className="left-0 top-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 border-0 bg-black/95 p-4 pb-6 shadow-none sm:rounded-none [&>button]:z-10 [&>button]:text-white [&>button]:hover:bg-white/10 [&>button]:hover:text-white [&>button]:ring-offset-black">
                      <DialogTitle className="sr-only">
                        {historyImageLightbox?.alt || "History image full screen"}
                      </DialogTitle>
                      {historyImageLightbox && (
                        <>
                          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
                            <img
                              src={historyImageLightbox.src}
                              alt={historyImageLightbox.alt}
                              className="max-h-[calc(100dvh-8rem)] max-w-full object-contain"
                            />
                          </div>
                          {(historyImageLightbox.description ||
                            historyImageLightbox.note) && (
                            <div className="mt-4 max-h-28 shrink-0 overflow-y-auto text-center text-sm text-white/90">
                              {historyImageLightbox.description && (
                                <p className="mb-1">{historyImageLightbox.description}</p>
                              )}
                              {historyImageLightbox.note && (
                                <p className="text-white/75">Note: {historyImageLightbox.note}</p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </DialogContent>
                  </Dialog>

                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No history entries found for this asset.</p>
                  ) : (
                    <div className="space-y-3">
                      {history.map((entry, idx) => (
                        <div key={`${entry.date || "entry"}-${idx}`} className="rounded-md border p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="font-medium">{entry.assetName || asset.assetName || "Asset"}</p>
                              <p className="text-xs text-muted-foreground">{entry.buildingAssetID || buildingAssetID}</p>
                            </div>
                            <Badge variant="secondary">{entry.date || "No date"}</Badge>
                          </div>
                          {entry.image && (
                            <div className="mb-2 space-y-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setHistoryImageLightbox({
                                    src: entry.image,
                                    alt: entry.assetName || asset.assetName || "Asset history",
                                    note: entry.note || "",
                                    description: entry.description || "",
                                  })
                                }
                                className="group relative block w-fit max-w-full rounded-md border bg-muted/30 text-left transition-opacity hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              >
                                <img
                                  src={entry.image}
                                  alt={entry.assetName || "Asset history"}
                                  className="max-h-40 rounded-md object-contain"
                                />
                                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                  <span className="flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow">
                                    <Maximize2 className="h-3.5 w-3.5" />
                                    View full screen
                                  </span>
                                </span>
                              </button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 bg-transparent"
                                onClick={() =>
                                  setHistoryImageLightbox({
                                    src: entry.image,
                                    alt: entry.assetName || asset.assetName || "Asset history",
                                    note: entry.note || "",
                                    description: entry.description || "",
                                  })
                                }
                              >
                                <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
                                View image full screen
                              </Button>
                            </div>
                          )}
                          {entry.description && <p className="text-sm mb-1">{entry.description}</p>}
                          {entry.note && <p className="text-sm text-muted-foreground">Note: {entry.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function AssetDetailsPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <AssetDetailsContent />
    </Suspense>
  )
}
