"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface CompletionStepProps {
    accountType: "PERSONAL" | "ORG";
    organizationName?: string;
    workspaceId?: string;
    onComplete: () => void;
}

/**
 * Completion Step – Congrats screen with redirect.
 */
export function CompletionStep({
    accountType,
    organizationName,
    workspaceId,
    onComplete,
}: CompletionStepProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleEnterApp = () => {
        setIsLoading(true);
        onComplete();
    };

    const getMessage = () => {
        if (accountType === "PERSONAL") {
            return "Your personal workspace is ready!";
        }
        if (organizationName && workspaceId) {
            return `${organizationName} and your first workspace are ready!`;
        }
        if (organizationName) {
            return `${organizationName} is ready! You can create workspaces anytime.`;
        }
        return "Your account is ready!";
    };

    return (
        <div className="w-full text-center">
            {/* Animated check icon */}
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                className="mx-auto w-20 h-20 rounded-full bg-green-100 dark:bg-green-500/15 flex items-center justify-center mb-6"
            >
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
            >
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground flex items-center justify-center gap-2">
                    Congratulations!
                </h1>
                <p className="mt-3 text-muted-foreground text-sm">
                    {getMessage()}
                </p>
            </motion.div>



            {/* CTA */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.4 }}
                className="mt-8"
            >
                <Button
                    className="w-full h-10 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleEnterApp}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Redirecting...
                        </>
                    ) : (
                        <>
                            Continue
                            <ArrowRight className="ml-2 h-5 w-5" />
                        </>
                    )}
                </Button>
            </motion.div>
        </div>
    );
}
