import React, { useState } from "react";
import { X, Calendar, User, Flag, Tag, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TimelineItem, STATUS_COLORS } from "../types";
import { WorkItemStatus, WorkItemPriority } from "@/features/sprints/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { WorkItemIcon } from "./work-item-icon";

interface TimelineDetailsPanelProps {
  item: TimelineItem | null;
  onClose: () => void;
  onUpdate: (itemId: string, updates: Partial<TimelineItem>) => void;
}

export function TimelineDetailsPanel({
  item,
  onClose,
  onUpdate,
}: TimelineDetailsPanelProps) {
  const [isEditing, setIsEditing] = useState<string | null>(null);

  if (!item) return null;

  // Provide a fallback status color in case status is undefined or invalid
  const statusStyle = STATUS_COLORS[item.status] || STATUS_COLORS.TODO;

  const handleFieldUpdate = (field: string, value: string | number | Date | undefined) => {
    onUpdate(item.id, { [field]: value });
    setIsEditing(null);
  };

  return (
    <div className="w-[400px] border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <WorkItemIcon type={item.type} className="h-5 w-5" />
              <span className="font-mono text-sm text-muted-foreground">
                {item.key}
              </span>
            </div>
            {isEditing === "title" ? (
              <Input
                autoFocus
                defaultValue={item.title}
                onBlur={(e) => handleFieldUpdate("title", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleFieldUpdate("title", e.currentTarget.value);
                  }
                }}
                className="font-medium text-lg"
              />
            ) : (
              <h2
                className="font-medium text-lg cursor-pointer hover:bg-muted/50 px-2 py-1 rounded"
                onClick={() => setIsEditing("title")}
              >
                {item.title}
              </h2>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Status */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Status
          </label>
          <Select
            value={item.status}
            onValueChange={(value) =>
              handleFieldUpdate("status", value as WorkItemStatus)
            }
          >
            <SelectTrigger className={cn("w-full", statusStyle.bg)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WorkItemStatus.TODO}>To Do</SelectItem>
              <SelectItem value={WorkItemStatus.IN_PROGRESS}>
                In Progress
              </SelectItem>
              <SelectItem value={WorkItemStatus.IN_REVIEW}>
                In Review
              </SelectItem>
              <SelectItem value={WorkItemStatus.DONE}>Done</SelectItem>
              <SelectItem value={WorkItemStatus.ASSIGNED}>Assigned</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Description
            </label>
            {isEditing === "description" ? (
              <Textarea
                autoFocus
                defaultValue={item.description || ""}
                onBlur={(e) => handleFieldUpdate("description", e.target.value)}
                rows={4}
                className="resize-none"
              />
            ) : (
              <div
                className="text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 p-2 rounded min-h-[60px]"
                onClick={() => setIsEditing("description")}
              >
                {item.description || "Click to add description..."}
              </div>
            )}
          </div>

          <Separator />

          {/* Details Grid */}
          <div className="space-y-4">
            {/* Assignees - filter out null entries from partially populated relations */}
            <div className="flex items-start gap-3">
              <User className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Assignees</label>
                {(() => {
                  const validAssignees = item.assignees?.filter(
                    (a): a is NonNullable<typeof a> => a != null && typeof a.name === "string"
                  ) ?? [];
                  return validAssignees.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {validAssignees.map((assignee) => (
                        <div
                          key={assignee.$id}
                          className="flex items-center gap-2 bg-muted px-2 py-1 rounded"
                        >
                          <Avatar className="h-5 w-5">
                            {assignee.profileImageUrl ? (
                              <AvatarImage
                                src={assignee.profileImageUrl}
                                alt={assignee.name}
                              />
                            ) : null}
                            <AvatarFallback className="text-xs">
                              {assignee.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{assignee.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Unassigned</p>
                  );
                })()}
              </div>
            </div>

            {/* Priority */}
            <div className="flex items-start gap-3">
              <Flag className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">
                  Priority
                </label>
                <Select
                  value={item.priority}
                  onValueChange={(value) =>
                    handleFieldUpdate("priority", value as WorkItemPriority)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WorkItemPriority.LOW}>Low</SelectItem>
                    <SelectItem value={WorkItemPriority.MEDIUM}>
                      Medium
                    </SelectItem>
                    <SelectItem value={WorkItemPriority.HIGH}>High</SelectItem>
                    <SelectItem value={WorkItemPriority.URGENT}>
                      Urgent
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dates */}
            <div className="flex items-start gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Timeline</label>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16">
                      Start:
                    </span>
                    <span className="text-sm">
                      {item.startDate
                        ? format(new Date(item.startDate), "MMM d, yyyy")
                        : "Not set"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16">
                      Due:
                    </span>
                    <span className="text-sm">
                      {item.dueDate
                        ? format(new Date(item.dueDate), "MMM d, yyyy")
                        : "Not set"}
                    </span>
                  </div>
                  {!item.hasExplicitDates && item.startDate && item.dueDate && (
                    <p className="text-xs text-muted-foreground">
                      {item.sprintId
                        ? "These dates come from the sprint. Drag the bar to set dates on this item."
                        : "These dates come from the sprints that contain this epic's work."}
                    </p>
                  )}
                  {!item.hasExplicitDates && !item.startDate && (
                    <p className="text-xs text-muted-foreground">
                      Dates are not set. Move this item into a sprint or pick dates to schedule it.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Estimated Hours */}
            <div className="flex items-start gap-3">
              <Clock className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">
                  Estimated Hours
                </label>
                {isEditing === "estimatedHours" ? (
                  <Input
                    type="number"
                    autoFocus
                    defaultValue={item.estimatedHours || ""}
                    onBlur={(e) =>
                      handleFieldUpdate(
                        "estimatedHours",
                        parseFloat(e.target.value) || 0
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleFieldUpdate(
                          "estimatedHours",
                          parseFloat(e.currentTarget.value) || 0
                        );
                      }
                    }}
                  />
                ) : (
                  <div
                    className="text-sm cursor-pointer hover:bg-muted/50 p-2 rounded"
                    onClick={() => setIsEditing("estimatedHours")}
                  >
                    {item.estimatedHours ? `${item.estimatedHours}h` : "Not set"}
                  </div>
                )}
              </div>
            </div>

            {/* Labels */}
            <div className="flex items-start gap-3">
              <Tag className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Labels</label>
                {item.labels && item.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {item.labels.map((label) => (
                      <Badge key={label} variant="secondary">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No labels</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Progress */}
          <div>
            <label className="text-sm font-medium mb-2 block">Progress</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              <span className="text-sm font-medium">{item.progress}%</span>
            </div>
          </div>

          {/* Subtasks */}
          {item.children && item.children.length > 0 && (
            <>
              <Separator />
              <div>
                <label className="text-sm font-medium mb-3 block">
                  Subtasks ({item.children.length})
                </label>
                <div className="space-y-2">
                  {item.children.map((subtask) => {
                    const subtaskStatusStyle = STATUS_COLORS[subtask.status] || STATUS_COLORS.TODO;
                    return (
                      <div
                        key={subtask.id}
                        className="flex items-center gap-2 p-2 border rounded hover:bg-muted/50"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {subtask.key}
                        </span>
                        <span className="text-sm flex-1 truncate">
                          {subtask.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            subtaskStatusStyle.bg,
                            subtaskStatusStyle.text
                          )}
                        >
                          {subtask.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
