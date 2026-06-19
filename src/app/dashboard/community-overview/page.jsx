'use client';

import { useEffect, useState, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { ModeToggle } from '@/components/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Flame,
  AlertTriangle,
  ListChecks,
  Layers,
  Maximize2,
  Minimize2,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import FirestoreService from '@/services/firestoreService';
import { useAppData } from '@/hooks/useAppData';
import { getStoredSessionUser } from '@/lib/sessionUser';
import { db } from '@/config/firebase';
import { doc, getDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { AssetControlModal } from '@/components/asset-control-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { rowsForLiveAlarmLikeDisplay, rowsForLiveTroubleDisplay } from '@/lib/liveAlarmFeedWrite';
import { PageHelpBanner } from "@/components/page-help-banner"
import { getMarkerImageSrc, handleImageError } from "@/lib/assetIcons"
import {
  getAssetMarkerTooltip,
  getFireBorderColor,
  getFireDimColor,
  mergeFireIntoActiveStatuses,
  resolveMarkerActive,
  shouldFireRipple,
} from "@/lib/assetFireStatus"
import { useFireStatusCache } from "@/stores/assetFireStatusStore"

// Dynamic import for 3D ModelViewer (no SSR)
const ModelViewer = dynamic(
  () => import('@/components/3d').then((mod) => mod.ModelViewer),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400 text-sm">Loading 3D Engine...</p>
        </div>
      </div>
    )
  }
);

const toModelProxyUrl = (url) => {
  if (!url) return '';
  return `/api/model-proxy?url=${encodeURIComponent(url)}`;
};

/** Firestore top-level collection id for a logical building name (matches listeners in this page) */
function communityOverviewBuildingDbId(logicalName) {
  if (!logicalName) return '';
  return logicalName.endsWith('BuildingDB') ? logicalName : `${logicalName}BuildingDB`;
}

function CommunityOverviewContent() {
  const mapBuildingName = (buildingName) => {
    const mappings = {
      'EMERALD PALM': 'THEMORA',
      'EMERALD PALMBuildingDB': 'THEMORA',
    };
    return mappings[buildingName] || buildingName;
  };

  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { communities: rawCommunities, isReady, effectiveRole } = useAppData({
    toastOnCommunitiesError: true,
  });
  const communityList = useMemo(
    () =>
      rawCommunities.map((community) => ({
        ...community,
        buildings: (community.buildings || []).map((building) => mapBuildingName(building)),
      })),
    [rawCommunities],
  );
  const userRole = effectiveRole || '';
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [buildingList, setBuildingList] = useState([]);

  // Dashboard states
  const [fireCount, setFireCount] = useState(0);
  const [troubleCount, setTroubleCount] = useState(0);
  const [supervisoryCount, setSupervisoryCount] = useState(0);
  const [disabledCount, setDisabledCount] = useState(0);
  const [liveAlarmData, setLiveAlarmData] = useState(null);
  const [liveTroubleData, setLiveTroubleData] = useState(null);
  const [liveSupervisoryData, setLiveSupervisoryData] = useState(null);
  const [generalAlarmData, setGeneralAlarmData] = useState(null);
  const [buildingAlarmViewMode, setBuildingAlarmViewMode] = useState('messages');
  const [selectedCardType, setSelectedCardType] = useState(null);
  /** alarm history right panel: archived alarmMessage vs live feed docs */
  const [alarmHistoryTab, setAlarmHistoryTab] = useState('general');
  const [liveFeedTabLoading, setLiveFeedTabLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('alarmHistory');
  const [floorMaps, setFloorMaps] = useState([]);
  const [selectedFloorMapName, setSelectedFloorMapName] = useState(null);
  const [currentFloorMap, setCurrentFloorMap] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [actualImageDimensions, setActualImageDimensions] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const [browserZoom, setBrowserZoom] = useState(1);
  const [activeStatuses, setActiveStatuses] = useState({});
  const [areaLabels, setAreaLabels] = useState([]);
  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [pendingAreaCoords, setPendingAreaCoords] = useState(null);
  const [loadingLiveData, setLoadingLiveData] = useState(false);
  const [selectedBuildingForFloor, setSelectedBuildingForFloor] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imageRef = useRef(null);
  const mapContainerRef = useRef(null);
  const actionTimeoutsRef = useRef({});

  // Asset control modal states
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [buildingStatus, setBuildingStatus] = useState('');

  // 3D Building view states
  const [viewMode, setViewMode] = useState('floorMap'); // 'floorMap' or '3dBuilding'
  const [buildingModelMeta, setBuildingModelMeta] = useState(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelUrl, setModelUrl] = useState('');
  const [modelType, setModelType] = useState('obj');
  const [buildingFor3D, setBuildingFor3D] = useState(null);
  const [buildingAssets3D, setBuildingAssets3D] = useState([]);
  const [activeStatuses3D, setActiveStatuses3D] = useState({});

  const fireStatusCache = useFireStatusCache();

  const mergedActiveStatuses3D = useMemo(
    () => mergeFireIntoActiveStatuses(activeStatuses3D, buildingAssets3D, fireStatusCache),
    [activeStatuses3D, buildingAssets3D, fireStatusCache],
  );

  const getDimColor = getFireDimColor;
  const getRadarBorderColor = getFireBorderColor;

  // Handle fullscreen toggle
  const handleFullscreen = () => {
    if (!mapContainerRef.current) return;

    if (!isFullscreen) {
      // Enter fullscreen
      if (mapContainerRef.current.requestFullscreen) {
        mapContainerRef.current.requestFullscreen().catch((err) => {
          console.error('Error attempting to enable fullscreen:', err);
          setIsFullscreen(true);
        });
      } else if (mapContainerRef.current.mozRequestFullScreen) {
        mapContainerRef.current.mozRequestFullScreen();
      } else if (mapContainerRef.current.webkitRequestFullscreen) {
        mapContainerRef.current.webkitRequestFullscreen();
      } else if (mapContainerRef.current.msRequestFullscreen) {
        mapContainerRef.current.msRequestFullscreen();
      } else {
        setIsFullscreen(true);
      }
      setIsFullscreen(true);
    } else {
      // Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (document.mozFullScreenElement) {
        document.mozCancelFullScreen();
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen();
      } else if (document.msFullscreenElement) {
        document.msExitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  // Handle keyboard escape to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen && !document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    return () => {
      Object.values(actionTimeoutsRef.current || {}).forEach((timeoutId) => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    };
  }, []);

  // Detect browser zoom level
  const detectZoom = () => {
    const zoom = window.devicePixelRatio || 1;
    return zoom;
  };

  // Recalculate image dimensions when fullscreen state changes
  useEffect(() => {
    if (imageLoaded && imageRef.current) {
      // Use a longer delay to ensure DOM transition completes
      setTimeout(() => {
        const img = imageRef.current;
        const containerRect = img.getBoundingClientRect();
        const zoom = detectZoom();
        
        // Account for browser zoom by dividing by zoom factor
        const containerWidth = containerRect.width / zoom;
        const containerHeight = containerRect.height / zoom;
        
        // Only update if we have valid dimensions
        if (containerWidth > 0 && containerHeight > 0) {
          const naturalWidth = img.naturalWidth || containerWidth;
          const naturalHeight = img.naturalHeight || containerHeight;
          const scaleX = containerWidth / naturalWidth;
          const scaleY = containerHeight / naturalHeight;
          const scale = Math.min(scaleX, scaleY);
          const displayedWidth = naturalWidth * scale;
          const displayedHeight = naturalHeight * scale;
          const offsetX = (containerWidth - displayedWidth) / 2;
          const offsetY = (containerHeight - displayedHeight) / 2;
          setBrowserZoom(zoom);
          setActualImageDimensions({
            width: displayedWidth,
            height: displayedHeight,
            offsetX,
            offsetY,
            naturalWidth,
            naturalHeight,
          });
        }
      }, 150);
    }
  }, [isFullscreen, imageLoaded]);

  // Add resize observer to detect zoom changes
  useEffect(() => {
    if (!imageRef.current) return;

    const handleResize = () => {
      if (imageLoaded && imageRef.current) {
        const img = imageRef.current;
        const containerRect = img.getBoundingClientRect();
        const zoom = detectZoom();
        const containerWidth = containerRect.width / zoom;
        const containerHeight = containerRect.height / zoom;
        
        if (containerWidth > 0 && containerHeight > 0) {
          const naturalWidth = img.naturalWidth || containerWidth;
          const naturalHeight = img.naturalHeight || containerHeight;
          const scaleX = containerWidth / naturalWidth;
          const scaleY = containerHeight / naturalHeight;
          const scale = Math.min(scaleX, scaleY);
          const displayedWidth = naturalWidth * scale;
          const displayedHeight = naturalHeight * scale;
          const offsetX = (containerWidth - displayedWidth) / 2;
          const offsetY = (containerHeight - displayedHeight) / 2;
          setBrowserZoom(zoom);
          setActualImageDimensions({
            width: displayedWidth,
            height: displayedHeight,
            offsetX,
            offsetY,
            naturalWidth,
            naturalHeight,
          });
        }
      }
    };

    // Listen for window resize (which includes zoom changes)
    window.addEventListener('resize', handleResize);

    // Use ResizeObserver for more precise detection
    const resizeObserver = new ResizeObserver(() => {
      if (imageLoaded) {
        handleResize();
      }
    });

    if (imageRef.current) {
      resizeObserver.observe(imageRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [imageLoaded]);

  useEffect(() => {
    if (!getStoredSessionUser()) {
      router.push('/');
    }
  }, [router]);

  useEffect(() => {
    if (!isReady || communityList.length === 0 || selectedCommunity) return;
    const communityParam = searchParams.get('community');
    if (communityParam) {
      setSelectedCommunity(decodeURIComponent(communityParam));
      return;
    }
    const first = communityList[0];
    setSelectedCommunity(first.communityName || first.name || null);
  }, [isReady, communityList, searchParams, selectedCommunity]);

  // Update building list when community changes
  useEffect(() => {
    if (!selectedCommunity) return;

    const selectedCommunityData = communityList.find((c) => c.communityName === selectedCommunity);
    if (selectedCommunityData) {
      setBuildingList(selectedCommunityData.buildings || []);
      setSelectedBuilding(null); // Don't auto-select, show all buildings
      setFloorMaps([]);
      setSelectedFloorMapName(null);
      setCurrentFloorMap(null);
      setSelectedBuildingForFloor(null);
      setExpandedBuildings({});
      setActiveStatuses({});
    }
  }, [selectedCommunity, communityList]);

  // Fetch building status when building changes
  useEffect(() => {
    const targetBuilding = selectedBuildingForFloor || selectedBuilding;
    if (targetBuilding) {
      fetchBuildingStatus(targetBuilding);
    } else {
      setBuildingStatus('');
    }
  }, [selectedBuilding, selectedBuildingForFloor]);

  // Real-time listener for building alarm data
  useEffect(() => {
    const unsubscribers = [];

    const setupRealtimeListeners = () => {
      // Reset counts
      const buildingCounts = {};

      const updateTotalCounts = () => {
        let totalFire = 0;
        let totalTrouble = 0;
        let totalSupervisory = 0;
        let totalDisabled = 0;

        Object.values(buildingCounts).forEach(counts => {
          totalFire += counts.fire || 0;
          totalTrouble += counts.trouble || 0;
          totalSupervisory += counts.supervisory || 0;
          totalDisabled += counts.disabled || 0;
        });

        setFireCount(totalFire);
        setTroubleCount(totalTrouble);
        setSupervisoryCount(totalSupervisory);
        setDisabledCount(totalDisabled);
      };

      const buildingsToMonitor = selectedBuilding ? [selectedBuilding] : buildingList;

      if (buildingsToMonitor.length === 0) {
        setFireCount(0);
        setTroubleCount(0);
        setSupervisoryCount(0);
        setDisabledCount(0);
        return;
      }

      // Set up real-time listener for each building
      buildingsToMonitor.forEach((building) => {
        const buildingDbName = building.endsWith('BuildingDB') ? building : `${building}BuildingDB`;
        const alarmDetailsRef = doc(db, buildingDbName, 'alarmDetails');

        const unsubscribe = onSnapshot(
          alarmDetailsRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              buildingCounts[building] = {
                fire: data.totalFire || 0,
                trouble: data.totalTrouble || 0,
                supervisory: data.totalSupervisory || 0,
                disabled: data.disabledDevice || 0,
              };
            } else {
              buildingCounts[building] = { fire: 0, trouble: 0, supervisory: 0, disabled: 0 };
            }
            updateTotalCounts();
          },
          (error) => {
            console.error(`Error listening to alarm details for ${building}:`, error);
            buildingCounts[building] = { fire: 0, trouble: 0, supervisory: 0, disabled: 0 };
            updateTotalCounts();
          }
        );

        unsubscribers.push(unsubscribe);
      });
    };

    setupRealtimeListeners();

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [selectedBuilding, selectedCommunity, buildingList]);

  // Fetch general alarm messages when component loads or buildings change
  useEffect(() => {
    const fetchGeneralAlarmMessages = async () => {
      try {
        const buildingsToFetch = selectedBuilding ? [selectedBuilding] : buildingList;
        if (buildingsToFetch.length === 0) return;

        let buildingData = [];
        for (const building of buildingsToFetch) {
          try {
            const result = await FirestoreService.getAlarmMessages(building);
            if (result && result.alarmMessages) {
              const details = await FirestoreService.getBuildingAlarmDetails(building);
              buildingData.push({
                buildingName: building,
                messages: result.alarmMessages,
                alarmDetails: {
                  totalFire: details?.totalFire || 0,
                  totalTrouble: details?.totalTrouble || 0,
                  totalSupervisory: details?.totalSupervisory || 0,
                  panelStatus: details?.panelStatus === true,
                },
              });
            }
          } catch (err) {
            console.error(`Error fetching alarm messages for ${building}:`, err);
          }
        }
        setGeneralAlarmData({ buildingData });
      } catch (error) {
        console.error('Error fetching general alarm messages:', error);
      }
    };

    fetchGeneralAlarmMessages();
    const interval = setInterval(fetchGeneralAlarmMessages, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [selectedBuilding, buildingList]);

  const handleBuildingAlarmViewToggle = () => {
    setBuildingAlarmViewMode((prev) => (prev === 'details' ? 'messages' : 'details'));
  };

  // Load floor maps
  useEffect(() => {
    const loadFloorMaps = async () => {
      try {
        let groupedMaps = [];
        let firstBuilding = null;
        let firstFloorName = null;

        if (selectedBuilding) {
          // Single building
          firstBuilding = selectedBuilding;
          const collectionName = `${selectedBuilding}BuildingDB`;
          const maps = await FirestoreService.getBuildingFloorMaps(collectionName);
          if (maps && maps.length > 0) {
            groupedMaps = [{ buildingName: selectedBuilding, floorMaps: maps }];
            firstFloorName = maps[0].name || maps[0].floorPlanName;
          }
        } else if (selectedCommunity) {
          // All buildings in community - group floor maps
          const selectedCommunityData = communityList.find((c) => c.communityName === selectedCommunity);
          const communityBuildings = selectedCommunityData?.buildings || [];
          if (communityBuildings.length === 0) {
            setFloorMaps([]);
            setSelectedFloorMapName(null);
            setCurrentFloorMap(null);
            setSelectedBuildingForFloor(null);
            return;
          }

          firstBuilding = communityBuildings[0];
          for (const building of communityBuildings) {
            try {
              const collectionName = `${building}BuildingDB`;
              const buildingMaps = await FirestoreService.getBuildingFloorMaps(collectionName);
              if (buildingMaps && buildingMaps.length > 0) {
                groupedMaps.push({ buildingName: building, floorMaps: buildingMaps });
                if (!firstFloorName) {
                  firstFloorName = buildingMaps[0].name || buildingMaps[0].floorPlanName;
                }
              }
            } catch (err) {
              console.error(`Error loading floor maps for ${building}:`, err);
            }
          }
        } else {
          setFloorMaps([]);
          setSelectedFloorMapName(null);
          setCurrentFloorMap(null);
          setSelectedBuildingForFloor(null);
          return;
        }

        setFloorMaps(groupedMaps || []);

        if (groupedMaps && groupedMaps.length > 0) {
          // Set first building as expanded and selected
          setSelectedBuildingForFloor(firstBuilding);
          setExpandedBuildings({ [firstBuilding]: true });
          setSelectedFloorMapName(firstFloorName);
          setCurrentFloorMap(null);
          setImageLoaded(false);
          setActiveStatuses({});

          try {
            const collectionName = `${firstBuilding}BuildingDB`;
            const detailed = await FirestoreService.getFloorMap(collectionName, firstFloorName);
            setCurrentFloorMap(detailed);
          } catch (err) {
            console.error('Error loading floor map:', err);
          }
        }
      } catch (err) {
        console.error('Error loading floor maps:', err);
      }
    };

    loadFloorMaps();
  }, [selectedBuilding, selectedCommunity, buildingList]);

  // Real-time listeners for assets
  useEffect(() => {
    const unsubscribersRef = [];

    const setupListeners = () => {
      if (!selectedFloorMapName) {
        setActiveStatuses({});
        return;
      }

      const buildingsToListen = selectedBuilding ? [selectedBuilding] : buildingList;

      if (buildingsToListen.length === 0) {
        setActiveStatuses({});
        return;
      }

      const categoryKeys = [
        'fire-life-safety',
        'electrical',
        'hvac',
        'plumbing',
        'elv',
        'security',
        'vertical-transport',
        'lighting',
        'bms',
        'landscaping',
        'additional',
      ];

      buildingsToListen.forEach((building) => {
        const buildingNameWithSuffix = `${building}BuildingDB`;
        categoryKeys.forEach((categoryKey) => {
          try {
            const categoryRef = collection(db, buildingNameWithSuffix, 'asset', categoryKey);
            const unsubscribe = onSnapshot(
              categoryRef,
              (snapshot) => {
                setActiveStatuses((prevStatuses) => {
                  const updatedStatuses = { ...prevStatuses };
                  snapshot.forEach((assetDoc) => {
                    const data = assetDoc.data();
                    if (data.floorPlanName === selectedFloorMapName && typeof data.x === 'number' && typeof data.y === 'number') {
                      const assetId = data.buildingAssetId || assetDoc.id;
                      updatedStatuses[assetId] = {
                        active: data.active || 0,
                        activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
                        enabled: data.enabled !== undefined ? data.enabled : true,
                        installed: data.installed || false,
                      };
                    }
                  });
                  return updatedStatuses;
                });
              }
            );
            unsubscribersRef.push(unsubscribe);
          } catch (error) {
            console.error(`Error setting up listener for ${building}/${categoryKey}:`, error);
          }
        });
      });
    };

    setupListeners();

    return () => {
      unsubscribersRef.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [selectedBuilding, selectedFloorMapName, buildingList]);

  // Load 3D building model when view mode is '3dBuilding'
  useEffect(() => {
    const loadBuildingModel = async () => {
      if (viewMode !== '3dBuilding' || !buildingFor3D) {
        setModelUrl('');
        setModelType('obj');
        setBuildingModelMeta(null);
        return;
      }

      setIsLoadingModel(true);
      try {
        const modelMeta = await FirestoreService.getBuildingModelMetadata(buildingFor3D);
        setBuildingModelMeta(modelMeta);

        if (modelMeta?.modelUrl) {
          setModelUrl(toModelProxyUrl(modelMeta.modelUrl));
          setModelType(modelMeta.modelType === 'fbx' ? 'fbx' : 'obj');
        } else {
          setModelUrl('');
          setModelType('obj');
          toast({
            title: 'No 3D Model',
            description: `No 3D model found for ${buildingFor3D}`,
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Error loading building 3D model:', error);
        setModelUrl('');
        setBuildingModelMeta(null);
        toast({
          title: 'Error',
          description: 'Failed to load building 3D model',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingModel(false);
      }
    };

    loadBuildingModel();
  }, [viewMode, buildingFor3D, toast]);

  // Load building assets with XYZ coordinates for 3D placement
  useEffect(() => {
    const loadBuildingAssetsFor3D = async () => {
      if (viewMode !== '3dBuilding' || !buildingFor3D) {
        setBuildingAssets3D([]);
        return;
      }

      try {
        const assetsByCategory = await FirestoreService.getBuildingAssets(buildingFor3D);
        const flattenedAssets = [];

        if (assetsByCategory?.categories) {
          Object.values(assetsByCategory.categories).forEach((category) => {
            Object.values(category.assets || {}).forEach((asset) => {
              const x = Number(asset?.coordinates?.x);
              const y = Number(asset?.coordinates?.y);
              const z = Number(asset?.coordinates?.z);

              if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                flattenedAssets.push({
                  id: asset.id,
                  assetName: asset.assetName || asset.deviceLocation || asset.id,
                  deviceAddress: asset.deviceAddress,
                  deviceLocation: asset.deviceLocation,
                  coordinates: { x, y, z },
                });
              }
            });
          });
        }

        setBuildingAssets3D(flattenedAssets);
      } catch (error) {
        console.error('Error loading building assets for 3D:', error);
        setBuildingAssets3D([]);
      }
    };

    loadBuildingAssetsFor3D();
  }, [viewMode, buildingFor3D]);

  // Real-time status monitoring for 3D building assets
  useEffect(() => {
    const unsubscribersRef = [];

    const setup3DListeners = () => {
      if (viewMode !== '3dBuilding' || !buildingFor3D) {
        setActiveStatuses3D({});
        return;
      }

      const buildingNameWithSuffix = `${buildingFor3D}BuildingDB`;
      const categoryKeys = [
        'fire-life-safety',
        'electrical',
        'hvac',
        'plumbing',
        'elv',
        'security',
        'vertical-transport',
        'lighting',
        'bms',
        'landscaping',
        'additional',
      ];

      categoryKeys.forEach((categoryKey) => {
        try {
          const categoryRef = collection(db, buildingNameWithSuffix, 'asset', categoryKey);
          const unsubscribe = onSnapshot(categoryRef, (snapshot) => {
            setActiveStatuses3D((prevStatuses) => {
              const updatedStatuses = { ...prevStatuses };

              snapshot.forEach((assetDoc) => {
                const data = assetDoc.data();
                const assetId = data.buildingAssetId || assetDoc.id;
                updatedStatuses[assetId] = {
                  active: data.active || 0,
                  activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
                  enabled: data.enabled !== undefined ? data.enabled : true,
                  installed: data.installed || false,
                };
              });

              return updatedStatuses;
            });
          });

          unsubscribersRef.push(unsubscribe);
        } catch (error) {
          console.error(`Error setting up 3D listener for ${buildingFor3D}/${categoryKey}:`, error);
        }
      });
    };

    setup3DListeners();

    return () => {
      unsubscribersRef.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [viewMode, buildingFor3D]);

  // Fetch live data
  const fetchLiveAlarmData = async () => {
    try {
      const buildingsToFetch = selectedBuilding ? [selectedBuilding] : buildingList;
      if (buildingsToFetch.length === 0) {
        setLiveAlarmData({ buildingData: [] });
        return;
      }

      const buildingData = [];
      for (const building of buildingsToFetch) {
        try {
          const dbCol = communityOverviewBuildingDbId(building);
          const snap = await getDoc(doc(db, dbCol, 'liveAlarm'));
          const messages = rowsForLiveAlarmLikeDisplay(snap, 'liveAlarm');
          const details = await FirestoreService.getBuildingAlarmDetails(building);
          buildingData.push({
            buildingName: building,
            messages,
            alarmDetails: {
              panelStatus: details?.panelStatus === true,
            },
          });
        } catch (err) {
          console.error(`Error fetching liveAlarm for ${building}:`, err);
        }
      }
      setLiveAlarmData({ buildingData });
    } catch (error) {
      console.error('Error fetching live alarm data:', error);
    }
  };

  const fetchLiveTroubleData = async () => {
    try {
      const buildingsToFetch = selectedBuilding ? [selectedBuilding] : buildingList;
      if (buildingsToFetch.length === 0) {
        setLiveTroubleData({ buildingData: [] });
        return;
      }

      const buildingData = [];
      for (const building of buildingsToFetch) {
        try {
          const dbCol = communityOverviewBuildingDbId(building);
          const snap = await getDoc(doc(db, dbCol, 'liveTrouble'));
          const messages = rowsForLiveTroubleDisplay(snap);
          const details = await FirestoreService.getBuildingAlarmDetails(building);
          buildingData.push({
            buildingName: building,
            messages,
            alarmDetails: {
              panelStatus: details?.panelStatus === true,
            },
          });
        } catch (err) {
          console.error(`Error fetching liveTrouble for ${building}:`, err);
        }
      }
      setLiveTroubleData({ buildingData });
    } catch (error) {
      console.error('Error fetching live trouble data:', error);
    }
  };

  const fetchLiveSupervisoryData = async () => {
    try {
      const buildingsToFetch = selectedBuilding ? [selectedBuilding] : buildingList;
      if (buildingsToFetch.length === 0) {
        setLiveSupervisoryData({ buildingData: [] });
        return;
      }

      const buildingData = [];
      for (const building of buildingsToFetch) {
        try {
          const dbCol = communityOverviewBuildingDbId(building);
          const snap = await getDoc(doc(db, dbCol, 'liveSupervisory'));
          const messages = rowsForLiveAlarmLikeDisplay(snap, 'liveSupervisory');
          const details = await FirestoreService.getBuildingAlarmDetails(building);
          buildingData.push({
            buildingName: building,
            messages,
            alarmDetails: {
              panelStatus: details?.panelStatus === true,
            },
          });
        } catch (err) {
          console.error(`Error fetching liveSupervisory for ${building}:`, err);
        }
      }
      setLiveSupervisoryData({ buildingData });
    } catch (error) {
      console.error('Error fetching live supervisory data:', error);
    }
  };

  // Fetch building status
  const fetchBuildingStatus = async (building) => {
    if (!building) {
      setBuildingStatus('');
      return;
    }
    
    try {
      const buildingNameWithSuffix = building + 'BuildingDB';
      const buildingDocRef = doc(db, buildingNameWithSuffix, 'buildingDetails');
      const buildingDoc = await getDoc(buildingDocRef);
      
      if (buildingDoc.exists()) {
        const data = buildingDoc.data();
        // Look for buildingStatus field
        const status = data.buildingStatus || data.status || '';
        setBuildingStatus(status);
      } else {
        setBuildingStatus('');
      }
    } catch (error) {
      console.error('Error fetching building status:', error);
      setBuildingStatus('');
    }
  };

  const handleMapClick = (event) => {
    if (!imageLoaded || !currentFloorMap || !selectedBuildingForFloor || !selectedFloorMapName) return;

    if (event.target.closest('button') || event.target.closest('[data-asset-marker="true"]')) {
      return;
    }

    const imgEl = imageRef.current;
    if (!imgEl) return;

    const naturalWidth = imgEl.naturalWidth || actualImageDimensions.naturalWidth;
    const naturalHeight = imgEl.naturalHeight || actualImageDimensions.naturalHeight;
    if (!naturalWidth || !naturalHeight) return;

    const imgRect = imgEl.getBoundingClientRect();
    const relativeX = (event.clientX - imgRect.left) / imgRect.width;
    const relativeY = (event.clientY - imgRect.top) / imgRect.height;

    if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return;

    const x = Math.round(relativeX * naturalWidth);
    const y = Math.round(relativeY * naturalHeight);

    setPendingAreaCoords({ x, y });
    setNewAreaName('');
    setIsAreaModalOpen(true);
  };

  const handleSaveAreaLabel = async () => {
    if (!selectedBuildingForFloor || !selectedFloorMapName || !pendingAreaCoords) return;

    const trimmedName = newAreaName.trim();
    if (!trimmedName) {
      toast({
        title: 'Area name required',
        description: 'Please enter an area name before saving',
        variant: 'destructive',
      });
      return;
    }

    const existingAreas = Array.isArray(currentFloorMap?.areaMappings)
      ? currentFloorMap.areaMappings
      : Array.isArray(areaLabels)
      ? areaLabels
      : [];
    const nextLabels = [
      ...existingAreas,
      {
        id: `area_${Date.now()}`,
        areaName: trimmedName,
        x: pendingAreaCoords.x,
        y: pendingAreaCoords.y,
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const floorRef = doc(
        db,
        `${selectedBuildingForFloor}BuildingDB`,
        'floorMaps',
        'floors',
        selectedFloorMapName
      );
      await updateDoc(floorRef, {
        areaMappings: nextLabels,
        updatedAt: new Date().toISOString(),
      });

      setAreaLabels(nextLabels);
      setCurrentFloorMap((prev) =>
        prev
          ? {
              ...prev,
              areaMappings: nextLabels,
            }
          : prev
      );
      setIsAreaModalOpen(false);
      setPendingAreaCoords(null);
      setNewAreaName('');

      toast({
        title: 'Area saved',
        description: `"${trimmedName}" has been added to this floor map`,
      });
    } catch (error) {
      console.error('Error saving map label:', error);
      toast({
        title: 'Error',
        description: 'Failed to save area label',
        variant: 'destructive',
      });
    }
  };

  // Handle asset click to open control modal
  const handleAssetClick = (mapping) => {
    // Use selectedBuildingForFloor which tracks the building of the displayed floor
    const targetBuilding = selectedBuildingForFloor || selectedBuilding;
    
    if (!targetBuilding) {
      toast({
        title: 'Select Building',
        description: 'Please select a building to control assets',
        variant: 'destructive',
      });
      return;
    }

    // Verify the building has construction status before allowing access
    if (!buildingStatus || buildingStatus.toLowerCase() !== 'construction') {
      toast({
        title: 'Feature Unavailable',
        description: `Asset controls are only available for buildings with 'Construction' status. ${targetBuilding} status: ${buildingStatus || 'Unknown'}`,
        variant: 'destructive',
      });
      return;
    }

    // Add the targetBuilding to the asset mapping so modal knows which building to use
    setSelectedAsset({ ...mapping, targetBuilding });
    setIsAssetModalOpen(true);
  };

  const handleCardClick = async (cardType) => {
    if (selectedCardType === cardType) {
      setSelectedCardType(null);
      setAlarmHistoryTab('general');
      return;
    }

    setActiveTab('alarmHistory');
    setSelectedCardType(cardType);
    if (cardType === 'fire') setAlarmHistoryTab('liveFire');
    if (cardType === 'trouble') setAlarmHistoryTab('liveTrouble');
    if (cardType === 'supervisory') setAlarmHistoryTab('liveSupervisory');
    setLoadingLiveData(true);

    const getBuildingDbName = (building) =>
      building && building.endsWith('BuildingDB') ? building : `${building}BuildingDB`;

    const pulseActionFieldForBuildings = async (fieldName, label) => {
      const targets = buildingList || [];
      if (targets.length === 0) return;
      try {
        await Promise.all(
          targets.map((building) => {
            const actionsRef = doc(db, getBuildingDbName(building), 'actions');
            return updateDoc(actionsRef, { [fieldName]: true });
          })
        );
        toast({
          title: 'Success',
          description: `${label} triggered for ${targets.length} building${targets.length !== 1 ? 's' : ''}`,
        });

        targets.forEach((building) => {
          const timeoutKey = `${fieldName}:${building}`;
          if (actionTimeoutsRef.current[timeoutKey]) {
            clearTimeout(actionTimeoutsRef.current[timeoutKey]);
          }
          actionTimeoutsRef.current[timeoutKey] = setTimeout(async () => {
            try {
              const actionsRef = doc(db, getBuildingDbName(building), 'actions');
              await updateDoc(actionsRef, { [fieldName]: false });
            } catch (err) {
              console.error(`Error resetting ${fieldName} for ${building}:`, err);
            }
          }, 5000);
        });
      } catch (err) {
        console.error(`Error setting ${fieldName}:`, err);
      }
    };

    try {
      switch (cardType) {
        case 'fire':
          await pulseActionFieldForBuildings('ack', 'ACK');
          await fetchLiveAlarmData();
          break;
        case 'trouble':
          await pulseActionFieldForBuildings('tack', 'TACK');
          await fetchLiveTroubleData();
          break;
        case 'supervisory':
          await pulseActionFieldForBuildings('sack', 'SACK');
          await fetchLiveSupervisoryData();
          break;
      }
    } catch (error) {
      console.error('Error in handleCardClick:', error);
    } finally {
      setLoadingLiveData(false);
    }
  };

  const handleAlarmHistoryTabChange = async (value) => {
    setAlarmHistoryTab(value);
    if (value === 'general') {
      setSelectedCardType(null);
      return;
    }
    setLiveFeedTabLoading(true);
    try {
      if (value === 'liveFire') await fetchLiveAlarmData();
      else if (value === 'liveSupervisory') await fetchLiveSupervisoryData();
      else if (value === 'liveTrouble') await fetchLiveTroubleData();
    } finally {
      setLiveFeedTabLoading(false);
    }
  };

  const alarmPanelSpinner =
    liveFeedTabLoading || (loadingLiveData && alarmHistoryTab !== 'general');

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes ripple {
        0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0.9; }
        70% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
        100% { opacity: 0; }
      }
      .ripple {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        animation: ripple 1.5s infinite;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    const labels = Array.isArray(currentFloorMap?.areaMappings)
      ? currentFloorMap.areaMappings
      : Array.isArray(currentFloorMap?.clickLabels)
      ? currentFloorMap.clickLabels
      : [];
    setAreaLabels(labels);
  }, [currentFloorMap]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <ModeToggle />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Community Overview</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <PageHelpBanner />
          {/* Community Selector */}
          <div className="flex gap-4">
            <Select value={selectedCommunity || ''} onValueChange={setSelectedCommunity}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select Community" />
              </SelectTrigger>
              <SelectContent>
                {communityList.map((community) => (
                  <SelectItem key={community.id} value={community.communityName}>
                    {community.communityName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Main Content */}
          {selectedCommunity ? (
            <div className="flex flex-1 gap-4">
              {/* Left Column - Floor maps + Floor view + Summary cards */}
              <div className="w-full flex flex-col gap-4 xl:w-2/3">
                {/* Main content area: left sidebar (floor list) + floor view */}
                <div className="flex gap-4 flex-1">
                  {/* Floor list */}
                  <div className="w-56 space-y-2">
                    <h4 className="font-semibold mb-2">Floor Plans</h4>
                    <div className="space-y-2">
                      {floorMaps && floorMaps.length > 0 ? (
                        floorMaps.map((buildingGroup) => (
                          <div key={buildingGroup.buildingName} className="border border-blue-950/40 rounded-lg overflow-hidden bg-blue-950/30">
                            <button
                              onClick={() => {
                                setExpandedBuildings((prev) => ({
                                  ...prev,
                                  [buildingGroup.buildingName]: !prev[buildingGroup.buildingName],
                                }));
                                if (!expandedBuildings[buildingGroup.buildingName]) {
                                  setSelectedBuildingForFloor(buildingGroup.buildingName);
                                  setBuildingFor3D(buildingGroup.buildingName);
                                }
                              }}
                              className="w-full text-left px-3 py-3 bg-blue-950/40 hover:bg-blue-950/50 font-bold text-base text-white flex items-center justify-between"
                            >
                              <span>{buildingGroup.buildingName}</span>
                              <span className="text-xs text-muted-foreground">
                                {buildingGroup.floorMaps.length} floor{buildingGroup.floorMaps.length !== 1 ? 's' : ''}
                              </span>
                            </button>
                            {expandedBuildings[buildingGroup.buildingName] && (
                              <div className="space-y-1 p-2 bg-blue-950/10">
                                {buildingGroup.floorMaps.map((fm, idx) => {
                                  const name = fm.name || fm.floorPlanName || `Floor ${idx + 1}`;
                                  return (
                                    <button
                                      key={name}
                                      onClick={async () => {
                                        setSelectedFloorMapName(name);
                                        setSelectedBuildingForFloor(buildingGroup.buildingName);
                                        setCurrentFloorMap(null);
                                        setImageLoaded(false);
                                        setActiveStatuses({});
                                        try {
                                          const collectionName = `${buildingGroup.buildingName}BuildingDB`;
                                          const detailed = await FirestoreService.getFloorMap(collectionName, name);
                                          setCurrentFloorMap(detailed);
                                        } catch (err) {
                                          console.error('Error fetching floor map details:', err);
                                        }
                                      }}
                                      className={`w-full text-left px-3 py-1.5 border border-blue-950/20 rounded text-xs ${
                                        selectedFloorMapName === name && selectedBuildingForFloor === buildingGroup.buildingName
                                          ? 'bg-blue-500/60 border-blue-500 text-white font-medium'
                                          : 'bg-transparent hover:bg-blue-950/10 font-normal text-gray-500'
                                      }`}
                                    >
                                      {name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">No floor plans available</div>
                      )}
                    </div>
                  </div>

                  {/* Tabbed viewport: Floor Map or 3D Building */}
                  <div className="flex-1 flex flex-col border border-blue-950/20 rounded-lg bg-blue-950/20">
                    <Tabs value={viewMode} onValueChange={setViewMode} className="flex flex-col h-full">
                      <div className="border-b border-blue-950/20 px-4 pt-3">
                        <TabsList className="grid w-full max-w-md grid-cols-2">
                          <TabsTrigger value="floorMap">Floor Map</TabsTrigger>
                          <TabsTrigger value="3dBuilding">3D Building</TabsTrigger>
                        </TabsList>
                      </div>

                      {/* Floor Map Tab */}
                      <TabsContent value="floorMap" className="flex-1 p-4 mt-0">
                        {currentFloorMap && currentFloorMap.imageUrl ? (
                          <>
                            {/* Header with fullscreen button */}
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-semibold text-sm">{selectedFloorMapName}</h4>
                              <Button
                                onClick={handleFullscreen}
                                variant="outline"
                                size="sm"
                                className="gap-2 h-8"
                                title={isFullscreen ? 'Exit Fullscreen (ESC)' : 'Enter Fullscreen'}
                              >
                                {isFullscreen ? (
                                  <Minimize2 className="h-4 w-4" />
                                ) : (
                                  <Maximize2 className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <div
                              ref={mapContainerRef}
                              className={`relative border border-blue-950/20 rounded overflow-hidden ${
                                isFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : ''
                              }`}
                              style={{
                                height: isFullscreen ? '100vh' : 'auto',
                              }}
                            >
                              <img
                                ref={imageRef}
                                src={currentFloorMap.imageUrl}
                                alt={selectedFloorMapName || 'Floor Map'}
                                className="block w-full h-auto object-contain"
                                style={{
                                  maxHeight: isFullscreen ? '100vh' : '500px',
                                }}
                                onLoad={() => {
                                  setImageLoaded(true);
                                  if (!imageRef.current) return;
                                  const img = imageRef.current;
                                  const containerRect = img.getBoundingClientRect();
                                  const zoom = detectZoom();
                                  const containerWidth = containerRect.width / zoom;
                                  const containerHeight = containerRect.height / zoom;
                                  const naturalWidth = img.naturalWidth || containerWidth;
                                  const naturalHeight = img.naturalHeight || containerHeight;
                                  const scaleX = containerWidth / naturalWidth;
                                  const scaleY = containerHeight / naturalHeight;
                                  const scale = Math.min(scaleX, scaleY);
                                  const displayedWidth = naturalWidth * scale;
                                  const displayedHeight = naturalHeight * scale;
                                  const offsetX = (containerWidth - displayedWidth) / 2;
                                  const offsetY = (containerHeight - displayedHeight) / 2;
                                  setBrowserZoom(zoom);
                                  setActualImageDimensions({
                                    width: displayedWidth,
                                    height: displayedHeight,
                                    offsetX,
                                    offsetY,
                                    naturalWidth,
                                    naturalHeight,
                                  });
                                }}
                                onClick={handleMapClick}
                              />

                              {/* Asset markers overlay */}
                              {imageLoaded && Array.isArray(currentFloorMap.assetMappings) && currentFloorMap.assetMappings.length > 0 && (
                                <div className="absolute inset-0 pointer-events-none">
                                  {currentFloorMap.assetMappings
                                    .filter((m) => {
                                      const floorName = currentFloorMap.floorPlanName || selectedFloorMapName;
                                      if (!floorName) return true;
                                      if (m.floorPlanName) return m.floorPlanName === floorName;
                                      if (m.floorPlan) return m.floorPlan === floorName;
                                      if (m.floor) return m.floor === floorName;
                                      return true;
                                    })
                                    .map((m, idx) => {
                                      if (typeof m.x !== 'number' || typeof m.y !== 'number') return null;
                                      const { width, height, offsetX, offsetY, naturalWidth, naturalHeight } = actualImageDimensions;
                                      const scaleX = naturalWidth ? width / naturalWidth : 1;
                                      const scaleY = naturalHeight ? height / naturalHeight : 1;
                                      const baseX = m.x * scaleX + offsetX;
                                      const baseY = m.y * scaleY + offsetY;
                                      // Apply zoom compensation
                                      const x = baseX * browserZoom;
                                      const y = baseY * browserZoom;
                                      const fallbackActive =
                                        activeStatuses && activeStatuses[m.id]
                                          ? activeStatuses[m.id].active
                                          : m.active || 0;
                                      const active = resolveMarkerActive(
                                        m.id,
                                        m.deviceAddress,
                                        fallbackActive,
                                        fireStatusCache,
                                      );
                                      const markerTooltip = getAssetMarkerTooltip(
                                        m,
                                        fireStatusCache.metaByAssetId,
                                      );

                                      return (
                                        <div
                                          key={m.id || `${idx}`}
                                          data-asset-marker="true"
                                          className="absolute z-20 cursor-pointer"
                                          style={{ left: x, top: y, pointerEvents: 'auto', transform: `translate(-50%, -50%) scale(${1 / browserZoom})`, transformOrigin: 'center' }}
                                          title={markerTooltip}
                                          onClick={() => handleAssetClick(m)}
                                        >
                                          <div
                                            className="absolute rounded-full"
                                            style={{
                                              left: '50%',
                                              top: '50%',
                                              transform: 'translate(-50%, -50%)',
                                              width: 40,
                                              height: 40,
                                              background: getDimColor(active),
                                              borderRadius: '50%',
                                              zIndex: -2,
                                              pointerEvents: 'none',
                                            }}
                                          />
                                          {shouldFireRipple(active) && (
                                            <div
                                              className="ripple"
                                              style={{
                                                width: 40,
                                                height: 40,
                                                zIndex: -1,
                                                border: `2px solid ${getRadarBorderColor(active)}`,
                                              }}
                                            />
                                          )}
                                          {(() => {
                                            const markerImgSrc = getMarkerImageSrc(m);
                                            return (
                                              <img
                                                src={markerImgSrc}
                                                alt={m.assetName || 'asset'}
                                                title={markerTooltip}
                                                className="w-6 h-6 rounded-full border-2 border-white shadow-lg object-cover"
                                                onError={handleImageError}
                                              />
                                            );
                                          })()}
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                              {imageLoaded && Array.isArray(areaLabels) && areaLabels.length > 0 && (
                                <div className="absolute inset-0 pointer-events-none z-10">
                                  {areaLabels.map((label) => {
                                    if (typeof label.x !== 'number' || typeof label.y !== 'number') return null;
                                    const { width, height, offsetX, offsetY, naturalWidth, naturalHeight } = actualImageDimensions;
                                    const scaleX = naturalWidth ? width / naturalWidth : 1;
                                    const scaleY = naturalHeight ? height / naturalHeight : 1;
                                    const baseX = label.x * scaleX + offsetX;
                                    const baseY = label.y * scaleY + offsetY;
                                    const x = baseX * browserZoom;
                                    const y = baseY * browserZoom;

                                    return (
                                      <div
                                        key={label.id || `${label.name}_${label.x}_${label.y}`}
                                        className="absolute"
                                        style={{
                                          left: x,
                                          top: y,
                                          transform: `translate(-50%, -120%) scale(${1 / browserZoom})`,
                                          transformOrigin: 'center',
                                        }}
                                      >
                                        <div className="rounded bg-blue-600/90 text-white text-[11px] px-2 py-1 whitespace-nowrap shadow-md">
                                          {label.areaName || label.name}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {isFullscreen && (
                                <Button
                                  onClick={handleFullscreen}
                                  variant="destructive"
                                  size="sm"
                                  className="absolute top-4 right-4 z-50 gap-2"
                                >
                                  <Minimize2 className="h-4 w-4" />
                                  Exit Fullscreen
                                </Button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="text-center text-muted-foreground py-12">Select a floor plan to view</div>
                        )}
                      </TabsContent>

                      {/* 3D Building Tab */}
                      <TabsContent value="3dBuilding" className="flex-1 p-4 mt-0">
                        {isLoadingModel ? (
                          <div className="flex items-center justify-center h-full min-h-[500px]">
                            <div className="text-center">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                              <p className="text-muted-foreground text-sm">Loading 3D Model...</p>
                            </div>
                          </div>
                        ) : buildingFor3D && modelUrl ? (
                          <div className="h-full min-h-[500px] border border-blue-950/20 rounded-lg overflow-hidden">
                            <ModelViewer
                              modelUrl={modelUrl}
                              modelType={modelType}
                              buildingName={buildingFor3D}
                              buildingAssets={buildingAssets3D}
                              activeStatuses={mergedActiveStatuses3D}
                              showGrid={true}
                              showAxes={true}
                              enableYAxisRotation={true}
                              yAxisRotateSpeed={1.0}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full min-h-[500px] text-center text-muted-foreground">
                            <div>
                              <Layers className="h-16 w-16 mx-auto mb-4 opacity-50" />
                              <p className="text-lg font-medium">Select a building to view its 3D model</p>
                              <p className="text-sm mt-2">Expand a building from the floor plans list</p>
                            </div>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>

                {/* Summary cards row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Card
                    className={`shadow-md cursor-pointer transition-transform hover:scale-105 border border-blue-950/20 ${fireCount > 0 ? 'bg-red-500 text-white' : 'bg-blue-950/20'} ${
                      selectedCardType === 'fire' ? 'border-blue-400' : ''
                    }`}
                    onClick={() => handleCardClick('fire')}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <p className={`text-sm ${fireCount > 0 ? 'text-white' : 'text-muted-foreground'}`}>Fire</p>
                        <p className={`text-2xl font-semibold ${fireCount > 0 ? 'text-white' : ''}`}>{fireCount}</p>
                      </div>
                      <Flame className={`h-8 w-8 ${fireCount > 0 ? 'text-white' : 'text-yellow-500'}`} />
                    </CardContent>
                  </Card>

                  <Card
                    className={`shadow-md cursor-pointer transition-transform hover:scale-105 border border-blue-950/20 ${troubleCount > 0 ? 'bg-yellow-400 text-black' : 'bg-blue-950/20'} ${
                      selectedCardType === 'trouble' ? 'border-blue-400' : ''
                    }`}
                    onClick={() => handleCardClick('trouble')}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <p className={`text-sm ${troubleCount > 0 ? 'text-black' : 'text-muted-foreground'}`}>Trouble</p>
                        <p className={`text-2xl font-semibold ${troubleCount > 0 ? 'text-black' : ''}`}>{troubleCount}</p>
                      </div>
                      <AlertTriangle className={`h-8 w-8 ${troubleCount > 0 ? 'text-black' : 'text-yellow-500'}`} />
                    </CardContent>
                  </Card>

                  <Card
                    className={`shadow-md cursor-pointer transition-transform hover:scale-105 border border-blue-950/20 ${supervisoryCount > 0 ? 'bg-amber-500 text-white' : 'bg-blue-950/20'} ${
                      selectedCardType === 'supervisory' ? 'border-blue-400' : ''
                    }`}
                    onClick={() => handleCardClick('supervisory')}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <p className={`text-sm ${supervisoryCount > 0 ? 'text-white' : 'text-muted-foreground'}`}>Supervisory</p>
                        <p className={`text-2xl font-semibold ${supervisoryCount > 0 ? 'text-white' : ''}`}>{supervisoryCount}</p>
                      </div>
                      <ListChecks className={`h-8 w-8 ${supervisoryCount > 0 ? 'text-white' : 'text-blue-500'}`} />
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Right Column - Alarm history */}
              <div className="w-full flex flex-col gap-4 h-full xl:w-1/3">
                <div className="border border-blue-950/20 rounded-lg p-4 h-[560px] flex flex-col bg-blue-950/20">
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-3 flex-wrap">
                    <span className="text-red-500">Fire {fireCount}</span>
                    <span className="text-yellow-500">Trouble {troubleCount}</span>
                    <span className="text-amber-500">Supervisory {supervisoryCount}</span>
                    <span className="text-slate-400">Disabled {disabledCount}</span>
                  </h3>

                  <Tabs
                    value={alarmHistoryTab}
                    onValueChange={handleAlarmHistoryTabChange}
                    className="flex flex-col flex-1 min-h-0 gap-0"
                  >
                    <TabsList className="mb-3 grid w-full grid-cols-2 gap-1 sm:grid-cols-4 h-auto py-1 shrink-0">
                      <TabsTrigger value="general" className="text-xs px-2">
                        Alarm archive
                      </TabsTrigger>
                      <TabsTrigger value="liveFire" className="text-xs px-2">
                        Live fire
                      </TabsTrigger>
                      <TabsTrigger value="liveSupervisory" className="text-xs px-2">
                        Live supervisory
                      </TabsTrigger>
                      <TabsTrigger value="liveTrouble" className="text-xs px-2">
                        Live trouble
                      </TabsTrigger>
                    </TabsList>

                    <div className="flex-1 overflow-auto text-muted-foreground min-h-0">
                    {alarmPanelSpinner ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        Loading messages…
                      </div>
                    ) : alarmHistoryTab === 'liveFire' && liveAlarmData ? (
                      <div className="space-y-4">
                        {liveAlarmData.buildingData?.length === 0 ? (
                          <div className="text-center py-4">No buildings to show.</div>
                        ) : (
                          liveAlarmData.buildingData?.map((buildingGroup, bidx) => (
                            <div key={bidx} className="space-y-2">
                              <h4 className="font-semibold text-sm px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-between gap-2">
                                <span>{buildingGroup.buildingName}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    buildingGroup.alarmDetails?.panelStatus
                                      ? 'bg-emerald-500/15 text-emerald-600'
                                      : 'bg-rose-500/15 text-rose-600'
                                  }`}
                                >
                                  Panel {buildingGroup.alarmDetails?.panelStatus ? 'ON' : 'OFF'}
                                </span>
                              </h4>
                              {buildingGroup.messages?.length === 0 ? (
                                <div className="text-sm text-muted-foreground px-2">No liveAlarm rows</div>
                              ) : (
                                <Table size="sm">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Time</TableHead>
                                      <TableHead>Message</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {buildingGroup.messages?.map((fire, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="align-top whitespace-nowrap">{fire.formattedTime}</TableCell>
                                        <TableCell className="text-red-600 font-medium break-words">{fire.message}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : alarmHistoryTab === 'liveTrouble' && liveTroubleData ? (
                      <div className="space-y-4">
                        {liveTroubleData.buildingData?.length === 0 ? (
                          <div className="text-center py-4">No buildings to show.</div>
                        ) : (
                          liveTroubleData.buildingData?.map((buildingGroup, bidx) => (
                            <div key={bidx} className="space-y-2">
                              <h4 className="font-semibold text-sm px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-between gap-2">
                                <span>{buildingGroup.buildingName}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    buildingGroup.alarmDetails?.panelStatus
                                      ? 'bg-emerald-500/15 text-emerald-600'
                                      : 'bg-rose-500/15 text-rose-600'
                                  }`}
                                >
                                  Panel {buildingGroup.alarmDetails?.panelStatus ? 'ON' : 'OFF'}
                                </span>
                              </h4>
                              {buildingGroup.messages?.length === 0 ? (
                                <div className="text-sm text-muted-foreground px-2">No liveTrouble rows</div>
                              ) : (
                                <Table size="sm">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Time</TableHead>
                                      <TableHead>Message</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {buildingGroup.messages?.map((t, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="align-top whitespace-nowrap">{t.formattedTime}</TableCell>
                                        <TableCell className="text-yellow-700 font-medium break-words">{t.message}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : alarmHistoryTab === 'liveSupervisory' && liveSupervisoryData ? (
                      <div className="space-y-4">
                        {liveSupervisoryData.buildingData?.length === 0 ? (
                          <div className="text-center py-4">No buildings to show.</div>
                        ) : (
                          liveSupervisoryData.buildingData?.map((buildingGroup, bidx) => (
                            <div key={bidx} className="space-y-2">
                              <h4 className="font-semibold text-sm px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-between gap-2">
                                <span>{buildingGroup.buildingName}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    buildingGroup.alarmDetails?.panelStatus
                                      ? 'bg-emerald-500/15 text-emerald-600'
                                      : 'bg-rose-500/15 text-rose-600'
                                  }`}
                                >
                                  Panel {buildingGroup.alarmDetails?.panelStatus ? 'ON' : 'OFF'}
                                </span>
                              </h4>
                              {buildingGroup.messages?.length === 0 ? (
                                <div className="text-sm text-muted-foreground px-2">No liveSupervisory rows</div>
                              ) : (
                                <Table size="sm">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Time</TableHead>
                                      <TableHead>Message</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {buildingGroup.messages?.map((s, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="align-top whitespace-nowrap">{s.formattedTime}</TableCell>
                                        <TableCell className="text-blue-600 font-medium break-words">{s.message}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : alarmHistoryTab === 'general' && generalAlarmData ? (
                      <div className="space-y-4">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={handleBuildingAlarmViewToggle}
                          >
                            {buildingAlarmViewMode === 'details' ? 'Show Messages' : 'Show AlarmDetails'}
                          </Button>
                        </div>
                        {generalAlarmData.buildingData?.length === 0 ? (
                          <div className="text-center py-4">No alarm messages found.</div>
                        ) : (
                          generalAlarmData.buildingData?.map((buildingGroup, bidx) => (
                            <div key={bidx} className="space-y-2">
                              <h4 className="font-semibold text-sm px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-between gap-2">
                                <span>{buildingGroup.buildingName}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    buildingGroup.alarmDetails?.panelStatus
                                      ? 'bg-emerald-500/15 text-emerald-600'
                                      : 'bg-rose-500/15 text-rose-600'
                                  }`}
                                >
                                  Panel {buildingGroup.alarmDetails?.panelStatus ? 'ON' : 'OFF'}
                                </span>
                              </h4>
                              {buildingAlarmViewMode === 'details' ? (
                                <div className="grid grid-cols-1 gap-2 px-2 sm:grid-cols-3">
                                  <div
                                    className={`rounded border px-3 py-2 text-sm ${
                                      (buildingGroup.alarmDetails?.totalFire || 0) > 0
                                        ? 'border-red-500/30 bg-red-500/10'
                                        : 'border-blue-950/20 bg-background/20'
                                    }`}
                                  >
                                    <span
                                      className={`font-medium ${
                                        (buildingGroup.alarmDetails?.totalFire || 0) > 0
                                          ? 'text-red-500'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      Fire
                                    </span>
                                    <div
                                      className={`font-semibold ${
                                        (buildingGroup.alarmDetails?.totalFire || 0) > 0
                                          ? 'text-red-500'
                                          : 'text-foreground'
                                      }`}
                                    >
                                      {buildingGroup.alarmDetails?.totalFire || 0}
                                    </div>
                                  </div>
                                  <div
                                    className={`rounded border px-3 py-2 text-sm ${
                                      (buildingGroup.alarmDetails?.totalTrouble || 0) > 0
                                        ? 'border-yellow-500/30 bg-yellow-500/10'
                                        : 'border-blue-950/20 bg-background/20'
                                    }`}
                                  >
                                    <span
                                      className={`font-medium ${
                                        (buildingGroup.alarmDetails?.totalTrouble || 0) > 0
                                          ? 'text-yellow-500'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      Trouble
                                    </span>
                                    <div
                                      className={`font-semibold ${
                                        (buildingGroup.alarmDetails?.totalTrouble || 0) > 0
                                          ? 'text-yellow-500'
                                          : 'text-foreground'
                                      }`}
                                    >
                                      {buildingGroup.alarmDetails?.totalTrouble || 0}
                                    </div>
                                  </div>
                                  <div
                                    className={`rounded border px-3 py-2 text-sm ${
                                      (buildingGroup.alarmDetails?.totalSupervisory || 0) > 0
                                        ? 'border-amber-500/30 bg-amber-500/10'
                                        : 'border-blue-950/20 bg-background/20'
                                    }`}
                                  >
                                    <span
                                      className={`font-medium ${
                                        (buildingGroup.alarmDetails?.totalSupervisory || 0) > 0
                                          ? 'text-amber-500'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      Supervisory
                                    </span>
                                    <div
                                      className={`font-semibold ${
                                        (buildingGroup.alarmDetails?.totalSupervisory || 0) > 0
                                          ? 'text-amber-500'
                                          : 'text-foreground'
                                      }`}
                                    >
                                      {buildingGroup.alarmDetails?.totalSupervisory || 0}
                                    </div>
                                  </div>
                                </div>
                              ) : buildingGroup.messages?.length === 0 ? (
                                <div className="text-sm text-muted-foreground px-2">No messages</div>
                              ) : (
                                <Table size="sm">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Time</TableHead>
                                      <TableHead>Message</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {buildingGroup.messages?.map((msg, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="align-top whitespace-nowrap">{msg.formattedTime}</TableCell>
                                        <TableCell className="font-medium break-words">{msg.message}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : alarmHistoryTab === 'general' ? (
                      <div className="text-center text-muted-foreground py-4">Loading alarm messages…</div>
                    ) : (
                      <div className="text-center text-muted-foreground py-4 text-sm">
                        Open this tab again or pick a building filter to load live feed data.
                      </div>
                    )}
                    </div>
                  </Tabs>
                </div>

                {/* Footer */}
                <div className="mt-auto flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
                  <div>{userRole || 'User'}</div>
                  <div className="flex items-center gap-3">
                    <div>{new Date().toLocaleString()}</div>
                    <img src="/logo.png" alt="Logo" className="h-6 w-auto" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Select a community to view details
            </div>
          )}
        </div>
      </SidebarInset>

      {/* Asset Control Modal */}
      <AssetControlModal
        isOpen={isAssetModalOpen}
        onClose={() => setIsAssetModalOpen(false)}
        asset={selectedAsset}
        selectedBuilding={selectedAsset?.targetBuilding || selectedBuildingForFloor || selectedBuilding}
        buildingStatus={buildingStatus}
        userRole={userRole}
      />

      <Dialog open={isAreaModalOpen} onOpenChange={setIsAreaModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Area Label</DialogTitle>
            <DialogDescription>
              Enter an area name. Coordinates will be saved to this floor map in BuildingDB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="areaName">Area name</Label>
            <Input
              id="areaName"
              placeholder="e.g. Lobby, Lift Area, Fire Exit"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveAreaLabel();
                }
              }}
              autoFocus
            />
            {pendingAreaCoords && (
              <p className="text-xs text-muted-foreground">
                Coordinates: ({pendingAreaCoords.x}, {pendingAreaCoords.y})
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAreaModalOpen(false);
                setPendingAreaCoords(null);
                setNewAreaName('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveAreaLabel}>Save Area</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

export default function CommunityOverview() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    }>
      <CommunityOverviewContent />
    </Suspense>
  );
}
