import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";

import { client } from "@/lib/rpc";
import { hardRedirectAfterAuth } from "@/features/auth/lib/hard-redirect-after-auth";

type ResponseType = InferResponseType<(typeof client.api["two-factor-auth"]["verify"])["$post"]>;
type RequestType = InferRequestType<(typeof client.api["two-factor-auth"]["verify"])["$post"]>;

export const useVerify2FA = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<ResponseType, Error, RequestType>({
        mutationFn: async ({ json }) => {
            const response = await client.api["two-factor-auth"]["verify"].$post({ json });

            if (!response.ok) {
                const errorData = await response.json() as { error: string };
                throw new Error(errorData.error || "Verification failed");
            }

            return await response.json();
        },
        onSuccess: () => {
            toast.success("Verification successful.");
            queryClient.removeQueries({ queryKey: ["current"] });
            queryClient.removeQueries({ queryKey: ["account-lifecycle"] });
            hardRedirectAfterAuth();
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });

    return mutation;
};
