import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";

import { client } from "@/lib/rpc";
import { hardRedirectAfterAuth } from "../lib/hard-redirect-after-auth";

type ResponseType = InferResponseType<
    (typeof client.api.auth)["first-login"]["$post"]
>;
type RequestType = InferRequestType<
    (typeof client.api.auth)["first-login"]["$post"]
>;

/**
 * First login magic link hook
 * 
 * After successful login:
 * - Backend sets auth cookie
 * - Redirects to /auth/callback for unified routing
 * - lifecycle-guard will trigger ForcePasswordReset if mustResetPassword is true
 */
export const useFirstLogin = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<ResponseType, Error, RequestType>({
        mutationFn: async ({ json }) => {
            const response = await client.api.auth["first-login"].$post({ json });
            return await response.json();
        },
        onSuccess: (data) => {
            if ('success' in data && data.success) {
                // Clear stale cache
                queryClient.clear();

                toast.success("Login successful!", {
                    description: "Welcome to Fairlx. Redirecting...",
                });

                hardRedirectAfterAuth();
            } else if ('error' in data && data.error) {
                toast.error(String(data.error));
            }
        },
        onError: () => {
            toast.error("Failed to log in via magic link.");
        },
    });

    return mutation;
};
