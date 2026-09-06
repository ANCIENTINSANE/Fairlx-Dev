"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";

import { useCurrent } from "@/features/auth/api/use-current";
import { useOnboardingLocalState } from "@/features/onboarding/hooks/use-onboarding-local-state";
import { routes } from "@/lib/routes";
import { ModeToggle } from "@/components/mode-toggle";
import { OnboardingErrorBoundary } from "./components/error-boundary";
import { OnboardingStepper, getStepsForAccountType } from "./components/onboarding-stepper";
import { AccountTypeStep } from "./components/account-type-step";
import { PersonalWorkspaceStep } from "./components/personal-workspace-step";
import { OrgDetailsStep } from "./components/org-details-step";
import { OrgWorkspaceStep } from "./components/org-workspace-step";
import { CompletionStep } from "./components/completion-step";

const stepVariants = {
    enter: { opacity: 0, x: 40 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -40 },
};

function OnboardingContent() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { data: user, isLoading: isUserLoading } = useCurrent();
    const {
        state,
        isInitialized,
        setAccountType,
        setOrganization,
        skipStep,
        completeOnboarding,
        goToStep,
        getTotalSteps
    } = useOnboardingLocalState();
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasSyncedWithServer, setHasSyncedWithServer] = useState(false);

    // Guard: Redirect if not authenticated
    useEffect(() => {
        if (!isUserLoading && !user) {
            router.replace("/sign-in");
        }
    }, [isUserLoading, user, router]);

    // Sync local state with server prefs on mount
    // This ensures that if user has already selected account type (stored in server),
    // we fast-forward to the correct step and prevent going back
    useEffect(() => {
        if (!user || !isInitialized || hasSyncedWithServer) return;

        const prefs = user.prefs || {};
        const serverAccountType = prefs.accountType as "PERSONAL" | "ORG" | undefined;
        const orgSetupComplete = prefs.orgSetupComplete === true;
        const primaryOrgId = prefs.primaryOrganizationId as string | undefined;

        // If server has account type but local state is at step 1, sync forward
        if (serverAccountType && state.step === 1) {
            if (serverAccountType === "PERSONAL") {
                // PERSONAL: advance to workspace step
                setAccountType("PERSONAL");
            } else if (serverAccountType === "ORG") {
                if (orgSetupComplete && primaryOrgId) {
                    // ORG with org created: advance to workspace step (step 3)
                    setAccountType("ORG");
                    setTimeout(() => {
                        setOrganization(primaryOrgId, prefs.organizationName as string || "Organization");
                    }, 50);
                } else {
                    // ORG without org: advance to org details step (step 2)
                    setAccountType("ORG");
                }
            }
        }

        setHasSyncedWithServer(true);
    }, [user, isInitialized, hasSyncedWithServer, state.step, setAccountType, setOrganization]);

    // Resume: leftover wizard state after a workspace was already created
    useEffect(() => {
        if (!isInitialized || isRedirecting || isSubmitting || !state.workspaceId) return;
        setIsSubmitting(true);
        completeOnboarding();
        setIsRedirecting(true);
        router.push(routes.agentDashboard());
    }, [isInitialized, isRedirecting, isSubmitting, state.workspaceId, completeOnboarding, router]);

    // Org skip-workspace only: no workspace yet → home resolver → /welcome
    const handleComplete = useCallback(() => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        completeOnboarding();
        setIsRedirecting(true);
        router.push("/");
    }, [isSubmitting, completeOnboarding, router]);

    const handleAccountTypeSelect = useCallback((type: "PERSONAL" | "ORG") => {
        if (isSubmitting) return;
        setAccountType(type);
    }, [isSubmitting, setAccountType]);

    const handleOrgCreated = useCallback((orgId: string, orgName: string) => {
        if (isSubmitting) return;
        setOrganization(orgId, orgName);
        queryClient.invalidateQueries({ queryKey: ["account-lifecycle"] });
        queryClient.invalidateQueries({ queryKey: ["current"] });
    }, [isSubmitting, setOrganization, queryClient]);

    const handleWorkspaceCreated = useCallback((_workspaceId: string) => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        completeOnboarding();
        setIsRedirecting(true);
        queryClient.invalidateQueries({ queryKey: ["account-lifecycle"] });
        queryClient.invalidateQueries({ queryKey: ["user-access"] });
        router.push(routes.agentDashboard());
    }, [isSubmitting, completeOnboarding, queryClient, router]);

    const handleSkipWorkspace = useCallback(() => {
        if (isSubmitting) return;
        skipStep("workspace");
    }, [isSubmitting, skipStep]);

    // Modified step click handler: Don't allow going back to step 1 if account type is already saved
    const handleStepClick = useCallback((stepNumber: number) => {
        if (isSubmitting) return;
        
        // Check if account type is saved to server - if so, prevent going back to step 1
        const prefs = user?.prefs || {};
        if (stepNumber === 1 && prefs.accountType) {
            // Account type is locked, can't go back
            return;
        }
        
        // For ORG accounts: if org is created, prevent going back to step 2 (Organization)
        if (stepNumber === 2 && prefs.accountType === "ORG" && prefs.orgSetupComplete) {
            // Organization step is locked, can't go back
            return;
        }
        
        // For PERSONAL accounts: if workspace is created, prevent going back to step 2 (Workspace)
        if (stepNumber === 2 && prefs.accountType === "PERSONAL" && state.workspaceId) {
            // Workspace step is locked, can't go back
            return;
        }
        
        goToStep(stepNumber);
    }, [isSubmitting, user, state.workspaceId, goToStep]);

    // Show loading while initializing
    if (isUserLoading || !isInitialized || isRedirecting) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <div className="text-center">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                    <p className="mt-4 text-sm text-muted-foreground">Setting up your account...</p>
                </div>
            </div>
        );
    }

    const steps = getStepsForAccountType(state.accountType);
    const currentStep = state.step;

    // Determine left panel content based on step
    const getLeftPanelContent = () => {
        if (currentStep === 1) {
            return {
                heading: "A few clicks away\nfrom setting up\nyour account.",
                subtext: "Get started in minutes.\nOrganize your work effortlessly.",
            };
        }
        const isOrgCompletion = state.accountType === "ORG" && currentStep >= 4;
        if (isOrgCompletion) {
            return {
                heading: "You're all set!\nWelcome to Fairlx.",
                subtext: "Your organization is ready.\nCreate a workspace whenever you like.",
            };
        }
        return {
            heading: "Almost there.\nJust a few more\ndetails.",
            subtext: "We're setting up your workspace.\nThis won't take long.",
        };
    };

    const leftContent = getLeftPanelContent();

    const renderStep = () => {
        if (state.step === 1 || state.accountType === null) {
            return (
                <AccountTypeStep
                    currentStep={1}
                    totalSteps={getTotalSteps()}
                    onSelectAccountType={handleAccountTypeSelect}
                />
            );
        }

        if (state.accountType === "PERSONAL") {
            return (
                <PersonalWorkspaceStep
                    currentStep={2}
                    totalSteps={getTotalSteps()}
                    userId={user?.$id || ""}
                    onWorkspaceCreated={handleWorkspaceCreated}
                />
            );
        }

        if (state.accountType === "ORG") {
            if (state.step === 2) {
                return (
                    <OrgDetailsStep
                        currentStep={2}
                        totalSteps={getTotalSteps()}
                        onOrgCreated={handleOrgCreated}
                    />
                );
            }
            if (state.step === 3) {
                return (
                    <OrgWorkspaceStep
                        currentStep={3}
                        totalSteps={getTotalSteps()}
                        organizationId={state.organizationId || ""}
                        organizationName={state.organizationName || ""}
                        onWorkspaceCreated={handleWorkspaceCreated}
                        onSkip={handleSkipWorkspace}
                    />
                );
            }
            return (
                <CompletionStep
                    accountType="ORG"
                    organizationName={state.organizationName}
                    workspaceId={state.workspaceId}
                    onComplete={handleComplete}
                />
            );
        }

        return null;
    };

    return (
        <div className="flex min-h-screen w-full">
            {/* ── Left Panel (Blue) ── */}
            <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col justify-between bg-blue-600 text-white p-9 relative overflow-hidden shrink-0">
                {/* Logo */}
                <div className="flex items-center gap-3 z-10">
                    {/* <div className="w-16 h-16 rounded-lg   flex items-center justify-center"> */}
                        <Image
                            src="/Logo.png"
                            alt="Fairlx"
                            width={84}
                            height={84}
                            className="brightness-0  invert"
                        />
                    {/* </div> */}
                </div>

                {/* Stepper (shown from step 2+) */}
                {state.accountType && currentStep > 1 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="z-10"
                    >
                        <OnboardingStepper
                            steps={steps}
                            currentStep={currentStep}
                            onStepClick={handleStepClick}
                            lockedSteps={[
                                ...(user?.prefs?.accountType ? [1] : []),
                                ...(user?.prefs?.accountType === "ORG" && user?.prefs?.orgSetupComplete ? [2] : []),
                                ...(user?.prefs?.accountType === "PERSONAL" && state.workspaceId ? [2] : []),
                            ]}
                        />
                    </motion.div>
                )}

                {/* Heading & Subtext */}
                <div className="z-10">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentStep}
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.35 }}
                        >
                            <h1 className="text-3xl xl:text-4xl font-bold leading-tight whitespace-pre-line">
                                {leftContent.heading}
                            </h1>
                            <p className="mt-4 text-blue-100 text-base leading-relaxed whitespace-pre-line">
                                {leftContent.subtext}
                            </p>
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Decorative shapes */}
                <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-blue-500/30 rounded-full blur-3xl" />
                <div className="absolute top-1/3 -right-20 w-56 h-56 bg-blue-400/20 rounded-full blur-2xl" />
            </div>

            {/* ── Right Panel (Content) ── */}
            <div className="flex-1 flex flex-col min-h-screen bg-background">
                {/* Top bar: help link + theme toggle */}
                <div className="flex items-center justify-end gap-3 p-4 sm:p-6">
                    <span className="text-sm text-muted-foreground">
                        Having troubles?{" "}
                        <a
                            href="mailto:contact@fairlx.com"
                            className="text-blue-600 text-sm dark:text-blue-400 font-medium hover:underline"
                        >
                            Get Help
                        </a>
                    </span>
                    <ModeToggle />
                </div>

                {/* Step content */}
                <div className="flex-1 flex items-center justify-center px-6 sm:px-12 pb-10">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={state.step + "-" + (state.accountType ?? "null")}
                            variants={stepVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                            className="w-full max-w-xl"
                        >
                            {renderStep()}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

export default function OnboardingPage() {
    return (
        <OnboardingErrorBoundary>
            <OnboardingContent />
        </OnboardingErrorBoundary>
    );
}
