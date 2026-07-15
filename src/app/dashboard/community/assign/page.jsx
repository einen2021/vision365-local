"use client"

import { useState, useEffect } from "react"
import { DashboardHeader } from "@/components/dashboard-header"
import { FirePanelStatusBadges } from "@/components/fire-panel-status-badges"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Building2,
  Users,
  Search,
  Loader2,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Home,
  Plus,
  Minus,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import secureLocalStorage from "react-secure-storage"
import { parseStoredUser } from "@/lib/sessionUser"
import endpoints from "@/config/api"
import dynamic from "next/dynamic"
import { useAppData } from "@/hooks/useAppData"
import { PageHelpBanner } from "@/components/page-help-banner"
import { FaqHelpButton } from "@/components/faq-help-button"

// Custom Checkbox component
const CustomCheckbox = ({ id, checked, onCheckedChange, className = "" }) => {
  return (
    <div className="flex items-center">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className={`h-4 w-4 rounded border border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 ${className}`}
      />
    </div>
  )
}

// Create a client-only ModeToggle
const ClientModeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => ({ default: mod.ModeToggle })),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9" />,
  },
)

export default function AssignCommunityPage() {
  const [mounted, setMounted] = useState(false)
  const { communities, refetchCommunities: fetchCommunities } = useAppData({
    toastOnCommunitiesError: true,
  })
  const [allBuildings, setAllBuildings] = useState([])
  const [unassignedBuildings, setUnassignedBuildings] = useState([])
  const [communityBuildings, setCommunityBuildings] = useState([])
  const [selectedCommunity, setSelectedCommunity] = useState("")
  const [selectedBuildings, setSelectedBuildings] = useState([])
  const [selectedCommunityBuildings, setSelectedCommunityBuildings] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [communitySearchTerm, setCommunitySearchTerm] = useState("")
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    fetchAllBuildings()
    fetchUnassignedBuildings()
  }, [])

  useEffect(() => {
    if (selectedCommunity) {
      fetchCommunityBuildings()
    } else {
      setCommunityBuildings([])
    }
  }, [selectedCommunity])

  const fetchAllBuildings = async () => {
    try {
      const user = parseStoredUser(secureLocalStorage.getItem("user"))
      if (!user?.email) return

      const response = await fetch(endpoints.getBuildingsWithCommunityStatus, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: user.email }),
      })

      const data = await response.json()
      if (data.status) {
        setAllBuildings(data.buildings || [])
      }
    } catch (error) {
      console.error("Error fetching all buildings:", error)
    }
  }

  const fetchUnassignedBuildings = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(endpoints.getUnassignedBuildings, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()
      if (data.status) {
        setUnassignedBuildings(data.buildings || [])
      }
    } catch (error) {
      console.error("Error fetching unassigned buildings:", error)
      toast({
        title: "Error",
        description: "Failed to fetch unassigned buildings",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchCommunityBuildings = async () => {
    if (!selectedCommunity) return

    try {
      const response = await fetch(endpoints.getCommunityBuildings(selectedCommunity), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()
      if (data.status) {
        setCommunityBuildings(data.buildings || [])
      }
    } catch (error) {
      console.error("Error fetching community buildings:", error)
      toast({
        title: "Error",
        description: "Failed to fetch community buildings",
        variant: "destructive",
      })
    }
  }

  const handleAssignBuildings = async () => {
    if (!selectedCommunity || selectedBuildings.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select a community and at least one building",
        variant: "destructive",
      })
      return
    }

    setIsAssigning(true)
    try {
      const user = secureLocalStorage.getItem("user")
      const user1 = parseStoredUser(user)
      const response = await fetch(endpoints.assignBuildingsToCommunity(selectedCommunity), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          buildings: selectedBuildings,
          updatedBy: user1?.email || "system",
        }),
      })

      const data = await response.json()
      if (data.status) {
        toast({
          title: "Success",
          description: `Successfully assigned ${selectedBuildings.length} buildings to community`,
        })
        setSelectedBuildings([])
        fetchUnassignedBuildings()
        fetchCommunityBuildings()
        fetchCommunities() // Refresh to update building counts
        fetchAllBuildings() // Refresh all buildings to update community status
      } else {
        throw new Error(data.message || "Failed to assign buildings")
      }
    } catch (error) {
      console.error("Error assigning buildings:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to assign buildings",
        variant: "destructive",
      })
    } finally {
      setIsAssigning(false)
    }
  }

  const handleRemoveBuildings = async () => {
    if (!selectedCommunity || selectedCommunityBuildings.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select buildings to remove",
        variant: "destructive",
      })
      return
    }

    setIsAssigning(true)
    try {
      const user = secureLocalStorage.getItem("user")
      const user1 = parseStoredUser(user)
      const response = await fetch(endpoints.removeBuildingsFromCommunity(selectedCommunity), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          buildings: selectedCommunityBuildings,
          updatedBy: user1?.email || "system",
        }),
      })

      const data = await response.json()
      if (data.status) {
        toast({
          title: "Success",
          description: `Successfully removed ${selectedCommunityBuildings.length} buildings from community`,
        })
        setSelectedCommunityBuildings([])
        fetchUnassignedBuildings()
        fetchCommunityBuildings()
        fetchCommunities() // Refresh to update building counts
        fetchAllBuildings() // Refresh all buildings to update community status
      } else {
        throw new Error(data.message || "Failed to remove buildings")
      }
    } catch (error) {
      console.error("Error removing buildings:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to remove buildings",
        variant: "destructive",
      })
    } finally {
      setIsAssigning(false)
    }
  }

  const handleBuildingSelection = (buildingName, checked) => {
    if (checked) {
      setSelectedBuildings([...selectedBuildings, buildingName])
    } else {
      setSelectedBuildings(selectedBuildings.filter((name) => name !== buildingName))
    }
  }

  const handleCommunityBuildingSelection = (buildingName, checked) => {
    if (checked) {
      setSelectedCommunityBuildings([...selectedCommunityBuildings, buildingName])
    } else {
      setSelectedCommunityBuildings(selectedCommunityBuildings.filter((name) => name !== buildingName))
    }
  }

  const selectAllUnassigned = () => {
    const filteredBuildings = unassignedBuildings.filter((building) =>
      building.buildingName?.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    setSelectedBuildings(filteredBuildings.map((building) => building.buildingName))
  }

  const clearAllUnassigned = () => {
    setSelectedBuildings([])
  }

  const selectAllCommunity = () => {
    const filteredBuildings = communityBuildings.filter((building) =>
      building.buildingName?.toLowerCase().includes(communitySearchTerm.toLowerCase()),
    )
    setSelectedCommunityBuildings(filteredBuildings.map((building) => building.buildingName))
  }

  const clearAllCommunity = () => {
    setSelectedCommunityBuildings([])
  }

  const filteredUnassignedBuildings = unassignedBuildings.filter((building) =>
    building.buildingName?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const filteredCommunityBuildings = communityBuildings.filter((building) =>
    building.buildingName?.toLowerCase().includes(communitySearchTerm.toLowerCase()),
  )

  const selectedCommunityData = communities.find((c) => c.id === selectedCommunity)

  if (!mounted) {
    return null
  }

  return (
    <DashboardHeader>
<div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <PageHelpBanner />
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-blue-500 text-white shadow-lg">
                <MapPin className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">Assign Community<FaqHelpButton articleId="page-community-assign" size="md" /></h1>
                <p className="text-muted-foreground">Assign buildings to communities and manage community membership</p>
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
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Available communities</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-950/40 dark:to-green-950/40 border-emerald-200 dark:border-emerald-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Unassigned Buildings
                </CardTitle>
                <Home className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                  {unassignedBuildings.length}
                </div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Available for assignment</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-amber-950/40 dark:to-yellow-950/40 border-amber-200 dark:border-amber-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Community Buildings
                </CardTitle>
                <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">{communityBuildings.length}</div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {selectedCommunityData ? `In ${selectedCommunityData.communityName}` : "Select community"}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-pink-100 dark:from-purple-950/40 dark:to-pink-950/40 border-purple-200 dark:border-purple-800 shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-purple-800 dark:text-purple-200">
                  Selected Buildings
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                  {selectedBuildings.length}
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Ready for assignment</p>
              </CardContent>
            </Card>
          </div>

          {/* Community Selection */}
          <Card className="shadow-lg border-green-200 dark:border-green-800 bg-gradient-to-r from-green-50 via-blue-50 to-green-50 dark:from-green-950/30 dark:via-blue-950/30 dark:to-green-950/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-900 dark:text-green-100">
                <Users className="h-5 w-5" />
                Community Selection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label htmlFor="community-select" className="text-green-800 dark:text-green-200">
                    Select Community
                  </Label>
                  <Select value={selectedCommunity} onValueChange={setSelectedCommunity}>
                    <SelectTrigger className="bg-white dark:bg-slate-800 border-green-200 dark:border-green-700">
                      <SelectValue placeholder="Choose a community to manage buildings" />
                    </SelectTrigger>
                    <SelectContent>
                      {communities.map((community) => (
                        <SelectItem key={community.id} value={community.id}>
                          <div className="flex items-center justify-between w-full">
                            <span>{community.communityName}</span>
                            <Badge variant="secondary" className="ml-2">
                              {community.totalBuildings || 0}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    fetchUnassignedBuildings()
                    fetchCommunityBuildings()
                    fetchAllBuildings()
                  }}
                  variant="outline"
                  disabled={isLoading}
                  className="bg-white dark:bg-slate-800 border-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              {selectedCommunityData && (
                <div className="mt-4 p-3 rounded-lg bg-green-100 dark:bg-green-900/20 border border-green-200 dark:border-green-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-green-900 dark:text-green-100">
                        {selectedCommunityData.communityName}
                      </h4>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        {selectedCommunityData.description || "No description available"}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-green-700 dark:text-green-300 border-green-300">
                      {selectedCommunityData.totalBuildings || 0} Buildings
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assignment Interface */}
          {selectedCommunity && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Unassigned Buildings */}
              <Card className="shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Home className="h-5 w-5" />
                      Unassigned Buildings ({filteredUnassignedBuildings.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        onClick={selectAllUnassigned}
                        variant="outline"
                        size="sm"
                        disabled={filteredUnassignedBuildings.length === 0}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Select All
                      </Button>
                      <Button
                        onClick={clearAllUnassigned}
                        variant="outline"
                        size="sm"
                        disabled={selectedBuildings.length === 0}
                      >
                        <Minus className="h-3 w-3 mr-1" />
                        Clear All
                      </Button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search unassigned buildings..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                  ) : filteredUnassignedBuildings.length === 0 ? (
                    <div className="text-center py-8">
                      <Home className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">
                        {searchTerm ? "No buildings found" : "No unassigned buildings"}
                      </h3>
                      <p className="text-muted-foreground">
                        {searchTerm
                          ? "Try adjusting your search criteria"
                          : "All buildings are assigned to communities"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {filteredUnassignedBuildings.map((building) => (
                        <div
                          key={building.buildingName}
                          className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          <CustomCheckbox
                            id={`unassigned-${building.buildingName}`}
                            checked={selectedBuildings.includes(building.buildingName)}
                            onCheckedChange={(checked) => handleBuildingSelection(building.buildingName, checked)}
                          />
                          <div className="flex-1">
                            <Label
                              htmlFor={`unassigned-${building.buildingName}`}
                              className="font-medium cursor-pointer"
                            >
                              {building.buildingName}
                            </Label>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {building.communityName || "Not Assigned"}
                              </Badge>
                            </div>
                          </div>
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedBuildings.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {selectedBuildings.length} building(s) selected
                        </span>
                        <Button onClick={handleAssignBuildings} disabled={isAssigning} size="sm">
                          {isAssigning ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Assigning...
                            </>
                          ) : (
                            <>
                              <ArrowRight className="h-3 w-3 mr-1" />
                              Assign to Community
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Community Buildings */}
              <Card className="shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Community Buildings ({filteredCommunityBuildings.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        onClick={selectAllCommunity}
                        variant="outline"
                        size="sm"
                        disabled={filteredCommunityBuildings.length === 0}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Select All
                      </Button>
                      <Button
                        onClick={clearAllCommunity}
                        variant="outline"
                        size="sm"
                        disabled={selectedCommunityBuildings.length === 0}
                      >
                        <Minus className="h-3 w-3 mr-1" />
                        Clear All
                      </Button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search community buildings..."
                      value={communitySearchTerm}
                      onChange={(e) => setCommunitySearchTerm(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredCommunityBuildings.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">
                        {communitySearchTerm ? "No buildings found" : "No buildings in community"}
                      </h3>
                      <p className="text-muted-foreground">
                        {communitySearchTerm
                          ? "Try adjusting your search criteria"
                          : "Assign buildings from the left panel to get started"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {filteredCommunityBuildings.map((building) => (
                        <div
                          key={building.buildingName}
                          className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          <CustomCheckbox
                            id={`community-${building.buildingName}`}
                            checked={selectedCommunityBuildings.includes(building.buildingName)}
                            onCheckedChange={(checked) =>
                              handleCommunityBuildingSelection(building.buildingName, checked)
                            }
                          />
                          <div className="flex-1">
                            <Label
                              htmlFor={`community-${building.buildingName}`}
                              className="font-medium cursor-pointer"
                            >
                              {building.buildingName}
                            </Label>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {building.communityName}
                              </Badge>
                            </div>
                          </div>
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedCommunityBuildings.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {selectedCommunityBuildings.length} building(s) selected
                        </span>
                        <Button onClick={handleRemoveBuildings} disabled={isAssigning} size="sm" variant="destructive">
                          {isAssigning ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Removing...
                            </>
                          ) : (
                            <>
                              <ArrowLeft className="h-3 w-3 mr-1" />
                              Remove from Community
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* No Community Selected */}
          {!selectedCommunity && (
            <Card className="border-dashed border-2 border-green-200 dark:border-green-800">
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <MapPin className="h-16 w-16 text-green-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Select a Community</h3>
                  <p className="text-muted-foreground">
                    Choose a community from the dropdown above to manage building assignments
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
  </DashboardHeader>  )
}
