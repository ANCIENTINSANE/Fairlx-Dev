import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { useRouter } from "next/navigation";

import { client } from "@/lib/rpc";

type ResponseType = InferResponseType<
  (typeof client.api.auth)["verify-email"]["$post"]
>;
type RequestType = InferRequestType<
  (typeof client.api.auth)["verify-email"]["$post"]
>;

/**
 * Verify email and auto-authenticate hook
 * 
 * After successful verification:
 * - Backend creates session and sets cookie
 * - User is auto-logged in
 * - Redirects to /auth/callback for unified post-auth routing
 * 
 * WHY redirect to callback:
 * - Same routing logic for all auth methods
 * - Callback determines if user needs onboarding
 */
export const useVerifyEmail = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation<ResponseType, Error, RequestType>({
    mutationFn: async ({ json }) => {
      const response = await client.api.auth["verify-email"].$post({ json });
      const data = await response.json();
      
      if (!response.ok && 'error' in data) {
        throw new Error(String(data.error));
      }
      
      return data;
    },
    onSuccess: (data) => {
      if ('success' in data && data.success) {
        // Clear any stale cache before redirecting
        queryClient.clear();

        // Check if auto-authenticated
        const autoAuthenticated = 'autoAuthenticated' in data && data.autoAuthenticated;

        if (autoAuthenticated) {
          toast.success("Email verified!", {
            description: "Welcome! Setting up your account...",
          });
          // Redirect to unified callback for post-auth routing
          router.push("/auth/callback");
        } else {
          // Fallback: redirect to sign-in
          toast.success("Email verified!", {
            description: "Please log in to continue.",
          });
          router.push("/sign-in");
        }
      } else if ('error' in data && data.error) {
        toast.error(String(data.error));
      }
    },
    onError: () => {
      toast.error("Failed to verify email.");
    },
  });

  return mutation;
};