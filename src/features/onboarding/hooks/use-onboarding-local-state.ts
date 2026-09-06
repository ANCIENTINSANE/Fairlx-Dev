"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Local-state-driven onboarding state management
 * 
 * WHY local state instead of backend prefs:
 * - Stepper can advance immediately on mutation success
 * - Survives page refresh (persisted to localStorage)
 * - Backend is source of truth for entities, local state for UI progression
 * - Prevents race conditions with cache invalidation
 * 
 * INVARIANTS:
 * - Step only advances when mutation succeeds
 * - State is cleared only when onboarding completes
 * - Account type must be selected before any entity creation
 */

export type AccountType = "PERSONAL" | "ORG" | null;

export interface OnboardingLocalState {
    step: number;
    accountType: AccountType;
    organizationId?: string;
    organizationName?: string;
    workspaceId?: string;
    completedSteps: string[];
    startedAt: string;
}

const STORAGE_KEY = "fairlx_onboarding_state";

const initialState: OnboardingLocalState = {
    step: 1, // Account type selection
    accountType: null,
    completedSteps: [],
    startedAt: new Date().toISOString(),
};

function getStoredState(): OnboardingLocalState | null {
    if (typeof window === "undefined") return null;

    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch {
        // Invalid stored state, ignore
    }
    return null;
}

function setStoredState(state: OnboardingLocalState) {
    if (typeof window === "undefined") return;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage unavailable, continue without persistence
    }
}

function clearStoredState() {
    if (typeof window === "undefined") return;

    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore
    }
}

/**
 * Hook for managing onboarding local state
 * 
 * Usage:
 * const { state, setAccountType, advanceStep, completeOnboarding } = useOnboardingLocalState();
 */
export function useOnboardingLocalState() {
    const [state, setState] = useState<OnboardingLocalState>(initialState);
    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize from localStorage
    useEffect(() => {
        const stored = getStoredState();
        if (stored) {
            setState(stored);
        }
        setIsInitialized(true);
    }, []);

    // Persist to localStorage on change (after initialization)
    useEffect(() => {
        if (isInitialized) {
            setStoredState(state);
        }
    }, [state, isInitialized]);

    const setAccountType = useCallback((accountType: "PERSONAL" | "ORG") => {
        setState((prev) => ({
            ...prev,
            accountType,
            step: 2, // Advance to next step
            completedSteps: [...prev.completedSteps, "account_type_selection"],
        }));
    }, []);

    const setOrganization = useCallback((organizationId: string, organizationName: string) => {
        setState((prev) => ({
            ...prev,
            organizationId,
            organizationName,
            step: prev.step + 1,
            completedSteps: [...prev.completedSteps, "organization_details"],
        }));
    }, []);

    const setWorkspace = useCallback((workspaceId: string) => {
        setState((prev) => ({
            ...prev,
            workspaceId,
            step: prev.step + 1,
            completedSteps: [...prev.completedSteps, "workspace_creation"],
        }));
    }, []);

    const advanceStep = useCallback((stepName: string) => {
        setState((prev) => ({
            ...prev,
            step: prev.step + 1,
            completedSteps: [...prev.completedSteps, stepName],
        }));
    }, []);

    const skipStep = useCallback((stepName: string) => {
        setState((prev) => ({
            ...prev,
            step: prev.step + 1,
            completedSteps: [...prev.completedSteps, `${stepName}_skipped`],
        }));
    }, []);

    const completeOnboarding = useCallback(() => {
        clearStoredState();
        setState(initialState);
    }, []);

    const resetOnboarding = useCallback(() => {
        clearStoredState();
        setState(initialState);
    }, []);

    /**
     * Navigate to a specific step (only for completed steps)
     * Used when user clicks completed step in stepper
     */
    const goToStep = useCallback((step: number) => {
        setState((prev) => {
            // Only allow going back to completed steps
            if (step < prev.step) {
                return {
                    ...prev,
                    step,
                };
            }
            return prev;
        });
    }, []);

    /**
     * Get total steps based on account type
     */
    const getTotalSteps = useCallback(() => {
        if (state.accountType === "PERSONAL") {
            return 2; // 1. Account Type, 2. Workspace (then Agent)
        } else if (state.accountType === "ORG") {
            return 4; // 1. Account Type, 2. Org Details, 3. Workspace (optional), 4. Complete (skip only)
        }
        return 2; // Default
    }, [state.accountType]);

    return {
        state,
        isInitialized,
        setAccountType,
        setOrganization,
        setWorkspace,
        advanceStep,
        skipStep,
        completeOnboarding,
        resetOnboarding,
        goToStep,
        getTotalSteps,
    };
}

