"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageLoader } from "@/components/page-loader";
import { PageError } from "@/components/page-error";

import { useGetProjects } from "@/features/projects/api/use-get-projects";
import { TimesheetView } from "@/features/time-tracking/components/timesheet-view";
import { EstimatesVsActuals } from "@/features/time-tracking/components/estimates-vs-actuals";
import { useRegisterAgentPage } from "@/features/agent/components/agent-page-context";
import { chromePageLayout } from "@/features/agent/lib/page-context";

export const TimeTrackingClient = () => {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const [tab, setTab] = useState("timesheet");

  const {
    data: projects,
    isLoading: isLoadingProjects,
    error: projectsError,
  } = useGetProjects({ workspaceId });

  useRegisterAgentPage(
    () => ({
      page: "Time tracking",
      layout: chromePageLayout("Time tracking", [
        { id: "main", position: "main", label: tab === "timesheet" ? "Timesheet" : "Estimates vs actuals" },
      ]),
      entities: (projects?.documents ?? []).slice(0, 12).map((project) => ({
        kind: "project",
        id: project.$id,
        title: project.name,
        location: "time tracking",
      })),
      ui: { tab },
      actions: ["set_view", "navigate"],
    }),
    (action) => {
      if (action.action === "set_view" && action.view) {
        const next = action.view.toLowerCase();
        if (next === "timesheet" || next === "estimates") {
          setTab(next);
          return true;
        }
      }
      return undefined;
    },
  );

  if (isLoadingProjects) {
    return <PageLoader />;
  }

  if (projectsError) {
    return <PageError message="Failed to load projects" />;
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Time Tracking</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
          <TabsTrigger value="estimates">Estimates vs Actuals</TabsTrigger>
        </TabsList>

        <TabsContent value="timesheet" className="space-y-4">
          <TimesheetView workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="estimates" className="space-y-4">
          <EstimatesVsActuals
            workspaceId={workspaceId}
            projects={projects?.documents}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
