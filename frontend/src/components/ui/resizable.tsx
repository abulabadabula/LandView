import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

export const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup className={cn("flex h-full w-full", className)} {...props} />
);

export const ResizablePanel = ResizablePrimitive.Panel;

export const ResizableHandle = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "group relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary",
      className,
    )}
    {...props}
  >
    <div className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border bg-card opacity-0 group-hover:opacity-100">
      <GripVertical className="size-2.5" />
    </div>
  </ResizablePrimitive.PanelResizeHandle>
);
