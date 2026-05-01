"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

import { useVerifyEmail } from "@/features/auth/api/use-verify-email";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const VerifyEmailContent = () => {
  const searchParams = useSearchParams();
  const verifyEmail = useVerifyEmail();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasAttempted = useRef(false);
  useEffect(() => {
    // Prevent multiple attempts
    if (hasAttempted.current) return;

    const userId = searchParams.get("userId");
    const secret = searchParams.get("secret");
    const token = searchParams.get("token");
    const custom = searchParams.get("custom");

    if (!userId || (!secret && !token)) {
      setStatus("error");
      setErrorMessage("Missing verification parameters in the URL.");
      return;
    }

    hasAttempted.current = true;

    verifyEmail.mutate(
      { json: { userId, secret: secret || undefined, token: token || undefined, custom: custom || undefined } },
      {
        onSuccess: (data) => {
          if ('success' in data && data.success) {
            setStatus("success");
          } else {
            setStatus("error");
            setErrorMessage('error' in data ? String(data.error) : "Verification failed. The link might be invalid or expired.");
          }
        },
        onError: (error) => {
          setStatus("error");
          setErrorMessage(error.message || "An unexpected error occurred during verification.");
        },
      }
    );
    // We intentionally run this effect only once on mount to avoid repeated verifications
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Verifying Email
            </CardTitle>
            <CardDescription>
              Please wait while we verify your email address...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Email Verified!
            </CardTitle>
            <CardDescription>
              Your email has been verified. Taking you to your dashboard...
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="h-5 w-5" />
            Verification Failed
          </CardTitle>
          <CardDescription>
            {errorMessage || "The verification link is invalid or has expired. Please try requesting a new verification email."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 bg-red-50 border border-red-100 rounded-md text-red-700 text-sm">
            <p className="font-medium mb-1">Detailed error:</p>
            <p>{errorMessage || "The link is invalid or has already been used."}</p>
          </div>
          <Button asChild variant="primary" className="w-full">
            <Link href="/sign-in">
              Back to Login
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/verify-email-needed">
              Request New Verification Email
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

const VerifyEmailPage = () => {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Verifying Email
            </CardTitle>
            <CardDescription>
              Please wait while we verify your email address...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
};

export default VerifyEmailPage;