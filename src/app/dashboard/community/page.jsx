"use client"

import { useState, useEffect } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Building2,
  Users,
  Plus,
  Edit,
  Trash2,
  Search,
  Calendar,
  MapPin,
  Loader2,
  RefreshCw,
  Home,
  Settings,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import secureLocalStorage from "react-secure-storage"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import { parseStoredUser } from "@/lib/sessionUser"
import { db } from "@/config/firebase"
import { collection, addDoc, doc, updateDoc, deleteDoc, getDoc, Timestamp } from "firebase/firestore"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"
import { HelpLabel } from "@/components/help-label"

// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

export default function CommunityManagementPage() {
  const [mounted, setMounted] = useState(false)
  const {
    communities,
    isLoadingCommunities: isLoading,
    refetchCommunities: fetchCommunities,
  } = useAppData({ toastOnCommunitiesError: true })
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedCommunity, setSelectedCommunity] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    communityName: "",
    description: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleCreateCommunity = async () => {
    if (!formData.communityName.trim()) {
      toast({
        title: "Validation Error",
        description: "Community name is required",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const user1 = parseStoredUser(secureLocalStorage.getItem("user"))

      const communityData = {
        communityName: formData.communityName.trim(),
        description: formData.description?.trim() || "",
        buildings: [],
        totalBuildings: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: user1?.email || "system",
        isActive: true,
      }

      await addDoc(collection(db, "communities"), communityData)

      toast({
        title: "Success",
        description: `Community '${formData.communityName}' created successfully`,
      })
      setIsCreateDialogOpen(false)
      setFormData({ communityName: "", description: "" })
      fetchCommunities()
    } catch (error) {
      console.error("Error creating community:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to create community",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditCommunity = async () => {
    if (!formData.communityName.trim()) {
      toast({
        title: "Validation Error",
        description: "Community name is required",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const user1 = parseStoredUser(secureLocalStorage.getItem("user"))

      const communityRef = doc(db, "communities", selectedCommunity.id)
      const communityDoc = await getDoc(communityRef)

      if (!communityDoc.exists()) {
        throw new Error(`Community not found with ID: ${selectedCommunity.id}`)
      }

      const updateData = {
        communityName: formData.communityName.trim(),
        description: formData.description.trim(),
        updatedAt: Timestamp.now(),
        updatedBy: user1?.email || "system",
      }

      await updateDoc(communityRef, updateData)

      toast({
        title: "Success",
        description: `Community '${formData.communityName}' updated successfully`,
      })
      setIsEditDialogOpen(false)
      setSelectedCommunity(null)
      setFormData({ communityName: "", description: "" })
      fetchCommunities()
    } catch (error) {
      console.error("Error updating community:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to update community",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteCommunity = async (community) => {
    setIsSubmitting(true)
    try {
      const communityRef = doc(db, "communities", community.id)
      const communityDoc = await getDoc(communityRef)

      if (!communityDoc.exists()) {
        throw new Error(`Community not found with ID: ${community.id}`)
      }

      const communityData = communityDoc.data()

      if (communityData.buildings && communityData.buildings.length > 0) {
        throw new Error(
          `Cannot delete community. ${communityData.buildings.length} buildings are still assigned to this community. Please reassign or remove buildings first.`,
        )
      }

      await deleteDoc(communityRef)

      toast({
        title: "Success",
        description: `Community '${community.communityName}' deleted successfully`,
      })
      fetchCommunities()
    } catch (error) {
      console.error("Error deleting community:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete community",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEditDialog = (community) => {
    setSelectedCommunity(community)
    setFormData({
      communityName: community.communityName,
      description: community.description || "",
    })
    setIsEditDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({ communityName: "", description: "" })
    setSelectedCommunity(null)
  }

  const filteredCommunities = communities.filter(
    (community) =>
      community.communityName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      community.description?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  if (!mounted) {
    return null
  }

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
                  <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Community Management</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <PageHelpBanner />
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                  Community Management
                  <FaqHelpButton articleId="page-community" size="md" />
                </h1>
                <p className="text-muted-foreground">Create, manage, and organize building communities</p>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-blue-50 to-sky-100 dark:from-blue-950/40 dark:to-sky-950/40 border-blue-200 dark:border-blue-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  Total Communities
                </CardTitle>
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{communities.length}</div>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Active communities</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-950/40 dark:to-green-950/40 border-emerald-200 dark:border-emerald-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Total Buildings
                </CardTitle>
                <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                  {communities.reduce((sum, community) => sum + (community.totalBuildings || 0), 0)}
                </div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Assigned buildings</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-amber-950/40 dark:to-yellow-950/40 border-amber-200 dark:border-amber-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Average Buildings
                </CardTitle>
                <Home className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">
                  {communities.length > 0
                    ? Math.round(
                        communities.reduce((sum, community) => sum + (community.totalBuildings || 0), 0) /
                          communities.length,
                      )
                    : 0}
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Per community</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-pink-100 dark:from-purple-950/40 dark:to-pink-950/40 border-purple-200 dark:border-purple-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-purple-800 dark:text-purple-200">
                  Largest Community
                </CardTitle>
                <MapPin className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                  {communities.length > 0 ? Math.max(...communities.map((c) => c.totalBuildings || 0)) : 0}
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Buildings</p>
              </CardContent>
            </Card>
          </div>

          {/* Actions Bar */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex-1 max-w-md">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search communities..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 pr-10"
                    />
                    <div className="absolute right-1 top-1.5">
                      <FaqHelpButton articleId="cm-search" />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={fetchCommunities} variant="outline" disabled={isLoading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={resetForm}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Community
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          Create New Community
                          <FaqHelpButton articleId="cm-create" />
                        </DialogTitle>
                        <DialogDescription>
                          Create a new community to organize and manage buildings together.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                          <HelpLabel
                            htmlFor="communityName"
                            articleId="cm-create--field--communityName"
                            required
                          >
                            Community Name
                          </HelpLabel>
                          <Input
                            id="communityName"
                            placeholder="Enter community name"
                            value={formData.communityName}
                            onChange={(e) => setFormData({ ...formData, communityName: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <HelpLabel htmlFor="description" articleId="cm-create--field--description">
                            Description
                          </HelpLabel>
                          <Input
                            id="description"
                            placeholder="Enter community description (optional)"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setIsCreateDialogOpen(false)
                            resetForm()
                          }}
                        >
                          Cancel
                        </Button>
                        <Button onClick={handleCreateCommunity} disabled={isSubmitting}>
                          {isSubmitting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              Create Community
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Communities Table */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Communities ({filteredCommunities.length})
                <FaqHelpButton articleId="cm-table" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-blue-500" />
                    <h3 className="text-lg font-semibold mb-2">Loading Communities</h3>
                    <p className="text-muted-foreground">Please wait while we fetch the communities...</p>
                  </div>
                </div>
              ) : filteredCommunities.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">
                    {searchTerm ? "No communities found" : "No communities yet"}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {searchTerm ? "Try adjusting your search criteria" : "Create your first community to get started"}
                  </p>
                  {!searchTerm && (
                    <Button onClick={() => setIsCreateDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create First Community
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Community Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-center">Buildings</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCommunities.map((community) => (
                        <TableRow key={community.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30">
                                <Users className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                              </div>
                              {community.communityName}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-xs">
                              {community.description ? (
                                <p className="text-sm text-muted-foreground truncate" title={community.description}>
                                  {community.description}
                                </p>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">No description</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary" className="font-mono">
                              {community.totalBuildings || 0}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {new Date(community.createdAt).toLocaleDateString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={community.isActive ? "default" : "secondary"}>
                              {community.isActive ? (
                                <>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Active
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Inactive
                                </>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditDialog(community)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Community</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete the community "{community.communityName}"?
                                      {community.totalBuildings > 0 && (
                                        <Alert className="mt-4">
                                          <AlertCircle className="h-4 w-4" />
                                          <AlertDescription>
                                            This community has {community.totalBuildings} buildings assigned. You need
                                            to reassign or remove these buildings before deleting the community.
                                          </AlertDescription>
                                        </Alert>
                                      )}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteCommunity(community)}
                                      disabled={community.totalBuildings > 0 || isSubmitting}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {isSubmitting ? (
                                        <>
                                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          Deleting...
                                        </>
                                      ) : (
                                        "Delete Community"
                                      )}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Edit Community</DialogTitle>
                <DialogDescription>Update the community information below.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="editCommunityName">Community Name *</Label>
                  <Input
                    id="editCommunityName"
                    placeholder="Enter community name"
                    value={formData.communityName}
                    onChange={(e) => setFormData({ ...formData, communityName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDescription">Description</Label>
                  <Input
                    id="editDescription"
                    placeholder="Enter community description (optional)"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditDialogOpen(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleEditCommunity} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Settings className="h-4 w-4 mr-2" />
                      Update Community
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
