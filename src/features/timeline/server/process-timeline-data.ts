import {
  TimelineItem,
  TimelineSprintGroup,
  TimelineGridConfig,
  TimelineZoomLevel,
  ZOOM_CONFIGS,
} from "../types";
import {
  PopulatedWorkItem,
  PopulatedSprint,
  WorkItemType,
} from "@/features/sprints/types";
import {
  workItemToTimelineItem,
  calculateTimelineRange,
  groupItemsBySprintAndEpic,
  flattenTimelineItems,
} from "../utils";

interface TimelineDataInput {
  sprints: {
    total: number;
    documents: PopulatedSprint[];
  };
  workItems: {
    total: number;
    documents: PopulatedWorkItem[];
  };
}

interface ProcessedTimelineData {
  allTimelineItems: TimelineItem[];
  sprintGroups: TimelineSprintGroup[];
  flatItems: TimelineItem[];
  gridConfig: TimelineGridConfig;
  epics: TimelineItem[];
  labels: string[];
  expandedItems: string[];
}

/**
 * Process timeline data on the server to reduce client-side computation
 * This handles all the expensive transformations, grouping, and flattening
 */
export function processTimelineData(
  data: TimelineDataInput,
  zoomLevel: TimelineZoomLevel = TimelineZoomLevel.WEEKS
): ProcessedTimelineData {
  // Auto-expand all sprints and unscheduled items
  const sprintIds = data.sprints.documents.map((s) => s.$id);
  const noEpicGroups = [
    "unscheduled",
    "no-epic-unscheduled",
    ...sprintIds.map((id) => `no-epic-${id}`),
  ];
  const expandedItems = [...sprintIds, ...noEpicGroups];
  const expandedSet = new Set(expandedItems);

  // Convert work items to timeline items
  const allTimelineItems: TimelineItem[] = data.workItems.documents.map((item) =>
    workItemToTimelineItem(item, 0, expandedSet, null, {
      workItems: data.workItems.documents,
      sprints: data.sprints.documents,
    })
  );

  // Group by sprints and epics
  const sprintGroups = groupItemsBySprintAndEpic(
    data.sprints.documents,
    data.workItems.documents,
    expandedSet
  );

  // Flatten for grid rendering
  const flatItems = flattenTimelineItems(sprintGroups);

  // Get epics for filter dropdown
  const epics = allTimelineItems.filter(
    (item) => item.type === WorkItemType.EPIC
  );

  // Extract all unique labels
  const labelsSet = new Set<string>();
  allTimelineItems.forEach((item) => {
    if (item.labels) {
      item.labels.forEach((label) => labelsSet.add(label));
    }
  });
  const labels = Array.from(labelsSet).sort();

  // Calculate timeline range and grid config
  const range = calculateTimelineRange(allTimelineItems, zoomLevel);
  const config = ZOOM_CONFIGS[zoomLevel];

  const gridConfig: TimelineGridConfig = {
    dayWidth: config.dayWidth,
    rowHeight: 48,
    headerHeight: 60,
    minDate: range.startDate,
    maxDate: range.endDate,
  };

  return {
    allTimelineItems,
    sprintGroups,
    flatItems,
    gridConfig,
    epics,
    labels,
    expandedItems,
  };
}
