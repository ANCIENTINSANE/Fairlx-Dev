"use client";

import React, { useMemo, useRef, useCallback, useTransition, useState } from "react";
import { GripVertical } from "lucide-react";
import { useTimelineState } from "@/features/timeline/hooks/use-timeline-store";
import { useUpdateTimelineItem } from "@/features/timeline/api/use-update-timeline-item";
import { TimelineHeader } from "@/features/timeline/components/timeline-header";
import { TimelineWorkTree } from "@/features/timeline/components/timeline-work-tree";
import { TimelineGrid } from "@/features/timeline/components/timeline-grid";
import { TimelineDetailsPanel } from "@/features/timeline/components/timeline-details-panel";
import {
  filterTimelineItems,
  flattenTimelineItems,
  calculateTimelineRange,
  dateToPixel,
  groupItemsBySprintAndEpic,
} from "@/features/timeline/utils";
import {
  TimelineGridConfig,
  TimelineItem,
  TimelineFilters,
  ZOOM_CONFIGS,
  TimelineSprintGroup,
  TimelineZoomLevel,
} from "@/features/timeline/types";
import { PopulatedWorkItem, PopulatedSprint } from "@/features/sprints/types";
import { CreateEpicDialog } from "@/features/sprints/components/create-epic-dialog";
import { useGetGitHubReleases } from "@/features/github-integration/api/use-github";
import { useRegisterAgentPage } from "@/features/agent/components/agent-page-context";
import { chromePageLayout, type PageSnapshotEntity } from "@/features/agent/lib/page-context";
import { normalizeZoom, type ParsedPageUiAction } from "@/features/agent/lib/page-ui-action";

interface TimelineClientProps {
  initialData: {
    allTimelineItems: TimelineItem[];
    sprintGroups: TimelineSprintGroup[];
    flatItems: TimelineItem[];
    gridConfig: TimelineGridConfig;
    epics: TimelineItem[];
    labels: string[];
    expandedItems: string[];
  };
  sprints: PopulatedSprint[];
  workItems: PopulatedWorkItem[];
  workspaceId: string;
  projectId?: string;
  showHeader?: boolean;
}

/**
 * Client-side interactive timeline component
 * Handles user interactions while working with server-provided data
 */
export function TimelineClient({
  initialData,
  sprints,
  workItems,
  workspaceId,
  projectId,
  showHeader = true,
}: TimelineClientProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isCreateEpicDialogOpen, setIsCreateEpicDialogOpen] = useState(false);
  const [workTreeWidth, setWorkTreeWidth] = useState(400);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = workTreeWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(Math.max(startWidthRef.current + delta, 200), 700);
      setWorkTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [workTreeWidth]);

  // State management
  const timelineState = useTimelineState();
  const {
    filters,
    setFilters,
    resetFilters,
    zoomLevel,
    setZoomLevel,
    selectedItemId,
    setSelectedItemId,
    expandedItems,
    toggleExpanded,
    collapseAll,
    setExpanded,
  } = timelineState;

  const { mutate: updateItem } = useUpdateTimelineItem();
  const { data: releases } = useGetGitHubReleases(projectId || "", !!projectId);

  // Initialize expanded items from server data
  React.useEffect(() => {
    if (expandedItems.size === 0 && initialData.expandedItems.length > 0) {
      setExpanded(initialData.expandedItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.expandedItems]);

  // Recompute groups when expansion changes (lightweight client-side operation)
  const sprintGroups = useMemo(() => {
    return groupItemsBySprintAndEpic(sprints, workItems, expandedItems);
  }, [sprints, workItems, expandedItems]);

  // Filter items based on current filters
  const filteredItems = useMemo(() => {
    return filterTimelineItems(initialData.allTimelineItems, filters);
  }, [initialData.allTimelineItems, filters]);

  // Flatten for grid rendering and remove duplicates by id to keep React keys stable
  const flatItems = useMemo(() => {
    const flattened = flattenTimelineItems(sprintGroups);
    const unique = new Map<string, TimelineItem>();

    flattened.forEach((item) => {
      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    });

    return Array.from(unique.values());
  }, [sprintGroups]);

  // Recalculate grid config when zoom changes
  const gridConfig: TimelineGridConfig = useMemo(() => {
    const range = calculateTimelineRange(filteredItems, zoomLevel);
    const config = ZOOM_CONFIGS[zoomLevel];

    return {
      dayWidth: config.dayWidth,
      rowHeight: 48,
      headerHeight: 60,
      minDate: range.startDate,
      maxDate: range.endDate,
    };
  }, [filteredItems, zoomLevel]);

  // Get selected item details - use flatItems (same as grid) for consistent dates
  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return (
      flatItems.find(
        (item: TimelineItem) => item.id === selectedItemId
      ) || null
    );
  }, [selectedItemId, flatItems]);

  // Check if all items are expanded
  const allExpanded = useMemo(() => {
    const allExpandableIds = [
      ...sprints.map((s) => s.$id),
      ...initialData.allTimelineItems.map((i: TimelineItem) => i.id),
    ];
    return allExpandableIds.every((id) => expandedItems.has(id));
  }, [sprints, initialData.allTimelineItems, expandedItems]);

  // Handlers
  const handleToggleExpandAll = useCallback(() => {
    startTransition(() => {
      if (allExpanded) {
        collapseAll();
      } else {
        const allIds = [
          ...sprints.map((s) => s.$id),
          ...initialData.allTimelineItems.map((i: TimelineItem) => i.id),
        ];
        setExpanded(allIds);
      }
    });
  }, [
    allExpanded,
    sprints,
    initialData.allTimelineItems,
    setExpanded,
    collapseAll,
  ]);

  const handleCenterToday = useCallback(() => {
    if (scrollContainerRef.current) {
      const todayX = dateToPixel(new Date(), gridConfig);
      scrollContainerRef.current.scrollLeft =
        todayX - scrollContainerRef.current.clientWidth / 2;
    }
  }, [gridConfig]);

  const handleItemUpdate = useCallback(
    (itemId: string, updates: Record<string, unknown>) => {
      updateItem({
        param: { workItemId: itemId },
        json: updates,
      });
    },
    [updateItem]
  );

  useRegisterAgentPage(
    () => {
      const entities: PageSnapshotEntity[] = [];
      const treeParts: string[] = [];
      const barKeys: string[] = [];
      for (const group of sprintGroups) {
        const sprintName = group.sprint.name;
        const expanded = expandedItems.has(group.sprint.$id);
        treeParts.push(`${sprintName} (${group.sprint.status}${expanded ? ", expanded" : ", collapsed"})`);
        if (!expanded) {
          entities.push({
            kind: "sprint",
            id: group.sprint.$id,
            title: sprintName,
            status: String(group.sprint.status),
            location: "work tree (collapsed)",
          });
          continue;
        }
        for (const epicGroup of group.epics) {
          const epic = epicGroup.epic;
          const epicExpanded = expandedItems.has(epic.id);
          if (epic.key) {
            entities.push({
              kind: epic.isLabelOnly ? "epic-label" : "epic",
              id: epic.id,
              key: epic.key,
              title: epic.title,
              status: String(epic.status),
              location: `${sprintName} · work tree`,
            });
          }
          if (!epicExpanded && epicGroup.tasks.length) {
            entities.push({
              kind: "note",
              id: `${epic.id}-collapsed`,
              title: `${epicGroup.tasks.length} tasks under ${epic.key || epic.title}`,
              location: `${sprintName} · collapsed`,
            });
            continue;
          }
          for (const task of epicGroup.tasks) {
            const hasBar = Boolean(task.startDate || task.dueDate);
            if (hasBar && task.key) barKeys.push(task.key);
            entities.push({
              kind: "work_item",
              id: task.id,
              key: task.key,
              title: task.title,
              status: String(task.status),
              location: `${sprintName} / ${epic.key || epic.title}`,
              extra: hasBar
                ? `bar ${task.startDate?.slice(0, 10) || "?"}–${task.dueDate?.slice(0, 10) || "?"}`
                : "no bar",
            });
          }
        }
      }
      const selected = selectedItem
        ? `${selectedItem.key || selectedItem.id} ${selectedItem.title}`
        : "none";
      return {
        page: projectId ? "Project timeline" : "Timeline",
        layout: chromePageLayout(projectId ? "Project timeline" : "Timeline", [
          { id: "tree", position: "main-left", label: "Sprint / epic tree", summary: treeParts.join("; ") || "empty" },
          {
            id: "grid",
            position: "main-right",
            label: "Gantt",
            summary: `zoom ${zoomLevel}. Bars: ${barKeys.slice(0, 12).join(", ") || "none"}`,
          },
          ...(selectedItem
            ? [{ id: "details", position: "details" as const, label: "Details panel", summary: selected }]
            : []),
        ]),
        entities,
        ui: {
          zoom: zoomLevel,
          selected: selectedItem?.key || selectedItemId || "",
          epicId: filters.epicId || "",
          type: filters.type || "ALL",
          status: filters.status || "ALL",
          label: filters.label || "",
          search: filters.search || "",
        },
        actions: ["set_zoom", "set_filters", "reset_filters", "select_item", "expand", "collapse", "navigate"],
      };
    },
    (action: ParsedPageUiAction) => {
      if (action.action === "set_zoom") {
        const zoom = normalizeZoom(action.zoom);
        if (zoom === "TODAY" || zoom === "WEEKS" || zoom === "MONTHS" || zoom === "QUARTERS") {
          setZoomLevel(zoom as TimelineZoomLevel);
          return true;
        }
        return { ok: false as const, error: "Unknown zoom." };
      }
      if (action.action === "reset_filters") {
        resetFilters();
        return true;
      }
      if (action.action === "set_filters" && action.filters) {
        const next: Partial<typeof filters> = {};
        if (action.filters.search !== undefined) next.search = action.filters.search || "";
        if (action.filters.status !== undefined) {
          next.status = (action.filters.status as TimelineFilters["status"]) || "ALL";
        }
        if (action.filters.type !== undefined) {
          next.type = (action.filters.type as TimelineFilters["type"]) || "ALL";
        }
        if (action.filters.label !== undefined) next.label = action.filters.label || null;
        if (action.filters.epicId !== undefined) next.epicId = action.filters.epicId || null;
        if (action.filters.sprintId !== undefined) next.sprintId = action.filters.sprintId || null;
        setFilters(next);
        return true;
      }
      if (action.action === "select_item" && action.itemId) {
        const needle = action.itemId.toLowerCase();
        const match =
          flatItems.find((item) => item.id === action.itemId || item.key.toLowerCase() === needle) ||
          null;
        if (!match) return { ok: false as const, error: `No item ${action.itemId} on this timeline.` };
        setSelectedItemId(match.id);
        return true;
      }
      if ((action.action === "expand" || action.action === "collapse") && action.itemId) {
        const needle = action.itemId.toLowerCase();
        const sprint = sprints.find(
          (item) => item.$id === action.itemId || item.name.toLowerCase() === needle,
        );
        const targetId =
          sprint?.$id ||
          (needle === "unscheduled" ? "unscheduled" : undefined) ||
          flatItems.find((item) => item.id === action.itemId || item.key.toLowerCase() === needle)?.id;
        if (!targetId) return { ok: false as const, error: `Nothing named ${action.itemId} to ${action.action}.` };
        const isOpen = expandedItems.has(targetId);
        if (action.action === "expand" && !isOpen) toggleExpanded(targetId);
        if (action.action === "collapse" && isOpen) toggleExpanded(targetId);
        return true;
      }
      return undefined;
    },
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Page Title Header */}
      {showHeader && (
        <div className="border-b bg-background px-6 py-4">
          <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Visualize your project timeline and track progress
          </p>
        </div>
      )}

      {/* Timeline Header with Filters */}
      <TimelineHeader
        filters={filters}
        onFiltersChange={setFilters}
        onResetFilters={resetFilters}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
        onToggleExpandAll={handleToggleExpandAll}
        allExpanded={allExpanded}
        onCenterToday={handleCenterToday}
        epics={initialData.epics}
        labels={initialData.labels}
        allItems={flatItems}
        onCreateEpic={projectId ? () => setIsCreateEpicDialogOpen(true) : undefined}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Work Tree Sidebar */}
        <TimelineWorkTree
          sprintGroups={sprintGroups}
          selectedItemId={selectedItemId}
          onItemClick={setSelectedItemId}
          onToggleExpanded={toggleExpanded}
          width={workTreeWidth}
        />

        {/* Resize Handle */}
        <div
          onMouseDown={handleResizeStart}
          className="w-1.5 bg-border hover:bg-primary/50 active:bg-primary/50 transition-colors cursor-col-resize flex items-center justify-center group shrink-0"
        >
          <GripVertical className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Timeline Grid */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-muted/10"
        >
          <TimelineGrid
            items={flatItems}
            gridConfig={gridConfig}
            zoomLevel={zoomLevel}
            selectedItemId={selectedItemId}
            onItemClick={setSelectedItemId}
            onItemUpdate={handleItemUpdate}
            scrollContainerRef={scrollContainerRef}
            releases={releases || []}
          />
        </div>

        {/* Details Panel */}
        {selectedItem && (
          <TimelineDetailsPanel
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
            onUpdate={handleItemUpdate}
          />
        )}
      </div>

      {/* Loading overlay */}
      {isPending && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center pointer-events-none">
          <div className="text-sm text-muted-foreground">Updating...</div>
        </div>
      )}

      {/* Create Epic Dialog - Only if we have a projectId */}
      {workspaceId && projectId && (
        <CreateEpicDialog
          workspaceId={workspaceId}
          projectId={projectId}
          open={isCreateEpicDialogOpen}
          onCloseAction={() => setIsCreateEpicDialogOpen(false)}
        />
      )}
    </div>
  );
}
