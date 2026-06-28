"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, Users } from "lucide-react";

/** Reused community + building pickers for all floor-plan pages. */
export function CommunityBuildingSelect({
  communities,
  isLoadingCommunities,
  selectedCommunity,
  onCommunityChange,
  buildings,
  selectedBuilding,
  onBuildingChange,
  floorCount,
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            Community
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Select Community</Label>
          <Select
            value={selectedCommunity}
            onValueChange={onCommunityChange}
            disabled={isLoadingCommunities}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isLoadingCommunities ? "Loading..." : "Select a community"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {communities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.communityName} ({c.totalBuildings} buildings)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5" />
            Building
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Select Building</Label>
          <Select
            value={selectedBuilding}
            onValueChange={onBuildingChange}
            disabled={!selectedCommunity}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  !selectedCommunity
                    ? "Select community first"
                    : "Select a building"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {buildings.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedBuilding && floorCount != null ? (
            <Badge variant="secondary">{floorCount} floors</Badge>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
