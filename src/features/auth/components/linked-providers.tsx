"use client";

import { useState } from "react";
import { Loader2, Link2, Link2Off, KeyRound, AlertTriangle, Plus } from "lucide-react";
import { FaGoogle, FaGithub } from "react-icons/fa";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useGetIdentities, LinkedIdentity } from "../api/use-get-identities";
import { useUnlinkIdentity } from "../api/use-unlink-identity";
import { signUpWithGoogle, signUpWithGithub } from "@/lib/oauth";
import { SetPasswordDialog } from "./set-password-dialog";
import { toast } from "sonner";

/**
 * Provider icon mapping
 */
const providerIcons: Record<string, React.ReactNode> = {
    google: <FaGoogle className="h-5 w-5" />,
    github: <FaGithub className="h-5 w-5" />,
};

const providerNames: Record<string, string> = {
    google: "Google",
    github: "GitHub",
};

/**
 * Linked Providers Component
 * 
 * Shows all linked authentication methods for the current user:
 * - Password (if set)
 * - Google OAuth
 * - GitHub OAuth
 * 
 * Features:
 * - Link new OAuth providers
 * - Unlink existing providers (with confirmation)
 * - Last-method protection (cannot unlink last auth method)
 * - Set password for OAuth-only users
 */
export function LinkedProviders() {
    const { data, isLoading, error } = useGetIdentities();
    const { mutate: unlinkIdentity, isPending: isUnlinking } = useUnlinkIdentity();
    const [unlinkTarget, setUnlinkTarget] = useState<LinkedIdentity | null>(null);
    const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
    const [isLinkingGithub, setIsLinkingGithub] = useState(false);
    const [isSetPasswordOpen, setIsSetPasswordOpen] = useState(false);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="h-5 w-5" />
                        Linked Accounts
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="h-5 w-5" />
                        Linked Accounts
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-destructive">Failed to load linked accounts</p>
                </CardContent>
            </Card>
        );
    }

    const { identities = [], hasPassword, canUnlink } = data || {};

    // Check which providers are already linked
    const linkedProviderNames = identities.map((i) => i.provider.toLowerCase());
    const hasGoogle = linkedProviderNames.includes("google");
    const hasGithub = linkedProviderNames.includes("github");

    const handleLinkGoogle = async () => {
        setIsLinkingGoogle(true);
        try {
            const result = await signUpWithGoogle("/profile");
            if (result?.error) {
                toast.error(result.error);
                setIsLinkingGoogle(false);
            }
        } catch {
            setIsLinkingGoogle(false);
        }
    };

    const handleLinkGithub = async () => {
        setIsLinkingGithub(true);
        try {
            const result = await signUpWithGithub("/profile");
            if (result?.error) {
                toast.error(result.error);
                setIsLinkingGithub(false);
            }
        } catch {
            setIsLinkingGithub(false);
        }
    };

    const handleUnlink = (identity: LinkedIdentity) => {
        if (!canUnlink) return;
        setUnlinkTarget(identity);
    };

    const confirmUnlink = () => {
        if (unlinkTarget) {
            unlinkIdentity(unlinkTarget.id);
            setUnlinkTarget(null);
        }
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="h-5 w-5" />
                        Linked Accounts
                    </CardTitle>
                    <CardDescription>
                        Manage how you sign in to your account
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Password Auth */}
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-background rounded-md">
                                <KeyRound className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="font-medium">Password</p>
                                <p className="text-sm text-muted-foreground">
                                    {hasPassword ? "Password set" : "No password set"}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant={hasPassword ? "default" : "secondary"}>
                                {hasPassword ? "Active" : "Not set"}
                            </Badge>
                            {!hasPassword && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsSetPasswordOpen(true)}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Set Password
                                </Button>
                            )}
                        </div>
                    </div>

                    <Separator />

                    {/* Linked OAuth Providers */}
                    {identities.map((identity) => (
                        <div key={identity.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-background rounded-md">
                                    {providerIcons[identity.provider.toLowerCase()] || <Link2 className="h-5 w-5" />}
                                </div>
                                <div>
                                    <p className="font-medium">{providerNames[identity.provider.toLowerCase()] || identity.provider}</p>
                                    <p className="text-sm text-muted-foreground">{identity.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge>Linked</Badge>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleUnlink(identity)}
                                    disabled={!canUnlink || isUnlinking}
                                    title={canUnlink ? "Unlink account" : "Cannot unlink last auth method"}
                                >
                                    <Link2Off className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}

                    {/* Link New Providers */}
                    {(!hasGoogle || !hasGithub) && (
                        <>
                            <Separator />
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">Link another account</p>
                                <div className="flex gap-2">
                                    {!hasGoogle && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleLinkGoogle}
                                            disabled={isLinkingGoogle}
                                        >
                                            {isLinkingGoogle ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <FaGoogle className="h-4 w-4 mr-2" />
                                            )}
                                            Google
                                        </Button>
                                    )}
                                    {!hasGithub && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleLinkGithub}
                                            disabled={isLinkingGithub}
                                        >
                                            {isLinkingGithub ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <FaGithub className="h-4 w-4 mr-2" />
                                            )}
                                            GitHub
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Warning if only one method */}
                    {!canUnlink && (
                        <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-700 dark:text-yellow-400">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            <p>You have only one login method. Link another account or set a password before unlinking.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Unlink Confirmation Dialog */}
            <AlertDialog open={!!unlinkTarget} onOpenChange={() => setUnlinkTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Unlink {unlinkTarget && providerNames[unlinkTarget.provider.toLowerCase()]}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You will no longer be able to sign in with this account. Make sure you have another way to access your account.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmUnlink} className="bg-destructive text-destructive-foreground">
                            Unlink
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Set Password Dialog */}
            <SetPasswordDialog
                open={isSetPasswordOpen}
                onOpenChange={setIsSetPasswordOpen}
            />
        </>
    );
}

