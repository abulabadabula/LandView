import { lazy, Suspense } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import Header from "@/components/layout/Header";
import Toolbar from "@/components/layout/Toolbar";
import StatusBar from "@/components/layout/StatusBar";
import LeftPanel from "@/components/layout/LeftPanel";
import RightPanel from "@/components/layout/RightPanel";
import MapView from "@/components/map/MapView";
import { useAppSelector } from "@/store";

const CesiumView = lazy(() => import("@/components/cesium/CesiumView"));
const ParcelTerrainView = lazy(() => import("@/components/cesium/ParcelTerrainView"));

export default function App() {
  const viewMode = useAppSelector((s) => s.ui.viewMode);
  return (
    <div className="flex h-full flex-col">
      <Header />
      <Toolbar />
      <ResizablePanelGroup direction="horizontal" autoSaveId="landview-layout" className="min-h-0 flex-1">
        <ResizablePanel id="left" order={1} defaultSize={24} minSize={16} maxSize={45}><LeftPanel /></ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="center" order={2} minSize={30}>
          {viewMode === "2d" ? (
            <MapView />
          ) : viewMode === "parcel3d" ? (
            <Suspense fallback={null}><ParcelTerrainView /></Suspense>
          ) : (
            <Suspense fallback={null}><CesiumView /></Suspense>
          )}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="right" order={3} defaultSize={18} minSize={12} maxSize={35}><RightPanel /></ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
    </div>
  );
}
