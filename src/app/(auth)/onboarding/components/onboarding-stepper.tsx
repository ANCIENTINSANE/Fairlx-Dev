"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepConfig {
    id: string;
    title: string;
    description?: string;
    optional?: boolean;
}

export type StepStatus = "completed" | "current" | "locked";

interface OnboardingStepperProps {
    steps: StepConfig[];
    currentStep: number;
    onStepClick?: (stepIndex: number) => void;
    /** Steps that are permanently locked (completed but can't go back to) */
    lockedSteps?: number[];
    className?: string;
}

/**
 * Vertical Stepper for the onboarding left panel.
 * Clean, minimal design inspired by StartGlobal UI.
 * No blinking animations.
 */
export function OnboardingStepper({
    steps,
    currentStep,
    onStepClick,
    lockedSteps = [],
    className,
}: OnboardingStepperProps) {
    const getStepStatus = (index: number): StepStatus => {
        if (index < currentStep - 1) return "completed";
        if (index === currentStep - 1) return "current";
        return "locked";
    };

    const handleStepClick = (index: number) => {
        const status = getStepStatus(index);
        const stepNumber = index + 1;
        // Don't allow clicking on locked steps (even if completed)
        if (lockedSteps.includes(stepNumber)) return;
        if (status === "completed" && onStepClick) {
            onStepClick(stepNumber);
        }
    };

    return (
        <nav
            className={cn("flex flex-col gap-0", className)}
            aria-label="Onboarding progress"
        >
            {steps.map((step, index) => {
                const status = getStepStatus(index);
                const isLast = index === steps.length - 1;
                const stepNumber = index + 1;
                const isStepLocked = lockedSteps.includes(stepNumber);

                return (
                    <div key={step.id} className="flex items-start gap-4">
                        {/* Vertical line + circle column */}
                        <div className="flex flex-col items-center">
                            {/* Circle */}
                            <button
                                type="button"
                                onClick={() => handleStepClick(index)}
                                disabled={status !== "completed" || isStepLocked}
                                className={cn(
                                    "relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300 shrink-0",
                                    "focus:outline-none",
                                    status === "completed" && !isStepLocked && [
                                        "bg-green-500 border-green-500 text-white",
                                        "cursor-pointer hover:bg-green-600 hover:border-green-600",
                                    ],
                                    status === "completed" && isStepLocked && [
                                        "bg-green-500 border-green-500 text-white",
                                        "cursor-not-allowed",
                                    ],
                                    status === "current" && [
                                        "bg-white/20 border-white text-white",
                                        "cursor-default",
                                    ],
                                    status === "locked" && [
                                        "bg-transparent border-white/30 text-white/30",
                                        "cursor-not-allowed",
                                    ]
                                )}
                                aria-current={status === "current" ? "step" : undefined}
                                aria-label={`Step ${stepNumber}: ${step.title}${isStepLocked ? " (locked)" : ""}`}
                            >
                                {status === "completed" ? (
                                    <Check className="w-5 h-5" strokeWidth={3} />
                                ) : (
                                    <span className="text-sm font-semibold">{stepNumber}</span>
                                )}
                            </button>

                            {/* Connecting line */}
                            {!isLast && (
                                <div
                                    className={cn(
                                        "w-0.5 h-10 transition-colors duration-300",
                                        status === "completed"
                                            ? "bg-green-500"
                                            : "bg-white/20"
                                    )}
                                />
                            )}
                        </div>

                        {/* Label */}
                        <div className="pt-2">
                            <p
                                className={cn(
                                    "text-sm font-semibold uppercase tracking-wider transition-colors duration-300",
                                    status === "completed" && "text-white/70",
                                    status === "current" && "text-white",
                                    status === "locked" && "text-white/30"
                                )}
                            >
                                {step.title}
                            </p>
                        </div>
                    </div>
                );
            })}
        </nav>
    );
}

/**
 * Get step configuration based on account type
 */
export function getStepsForAccountType(accountType: "PERSONAL" | "ORG" | null): StepConfig[] {
    const accountTypeStep: StepConfig = {
        id: "account-type",
        title: "Account Type",
        description: "Choose your account type"
    };

    if (accountType === "PERSONAL") {
        return [
            accountTypeStep,
            {
                id: "workspace",
                title: "Workspace",
                description: "Set up your workspace"
            },
        ];
    }

    if (accountType === "ORG") {
        return [
            accountTypeStep,
            {
                id: "org-details",
                title: "Organization",
                description: "Set up your organization"
            },
            {
                id: "workspace",
                title: "Workspace",
                description: "Create a workspace",
                optional: true
            },
            {
                id: "complete",
                title: "Complete",
                description: "You're all set!"
            }
        ];
    }

    // Default before selection
    return [
        accountTypeStep,
        {
            id: "next-step",
            title: "Setup",
            description: "Based on your selection"
        },
        {
            id: "complete",
            title: "Complete",
            description: "You're all set!"
        }
    ];
}
