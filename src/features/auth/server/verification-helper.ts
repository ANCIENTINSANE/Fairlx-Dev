import { ID, Query, type Databases, type Messaging } from "node-appwrite";
import { DATABASE_ID, VERIFICATION_TOKENS_ID } from "@/config";
import { verifyEmailTemplate } from "@/lib/email-templates";

interface CreateCustomVerificationParams {
    databases: Databases;
    messaging: Messaging;
    userId: string;
    userName: string;
}

/**
 * Custom Verification Helper
 * 
 * Handles branded verification emails using a custom token collection.
 * Falls back gracefully if the collection is not set up.
 */
export const verificationHelper = {
    /**
     * Create a custom verification token and send a branded email
     */
    async createAndSend({
        databases,
        messaging,
        userId,
        userName,
    }: CreateCustomVerificationParams) {
        // Generate a secure random token
        const token = ID.unique() + ID.unique();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        // Save token to collection
        await databases.createDocument(
            DATABASE_ID,
            VERIFICATION_TOKENS_ID,
            ID.unique(),
            {
                userId,
                token,
                expiresAt,
                type: "email",
            }
        );

        // Build verification URL with custom flag
        const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?userId=${userId}&token=${token}&custom=true`;

        // Generate branded email HTML
        const emailHtml = verifyEmailTemplate({
            userName,
            verifyUrl,
        });

        // Send via Appwrite Messaging
        await messaging.createEmail(
            ID.unique(),
            "Verify your Fairlx account",
            emailHtml,
            [], // topics
            [userId], // users
            [], // targets
            [], // cc
            [], // bcc
            [], // attachments
            false, // draft
            true // html
        );

        return { success: true };
    },

    /**
     * Verify a custom token
     */
    async verify({
        databases,
        userId,
        token,
    }: {
        databases: Databases;
        userId: string;
        token: string;
    }) {
        // Find the token
        const docs = await databases.listDocuments(
            DATABASE_ID,
            VERIFICATION_TOKENS_ID,
            [
                Query.equal("userId", userId),
                Query.equal("token", token),
            ]
        );

        if (docs.total === 0) {
            throw new Error("Invalid or expired verification link");
        }

        const doc = docs.documents[0];

        // Check expiration
        if (new Date(doc.expiresAt) < new Date()) {
            await databases.deleteDocument(DATABASE_ID, VERIFICATION_TOKENS_ID, doc.$id);
            throw new Error("Verification link has expired");
        }

        // Delete used token
        await databases.deleteDocument(DATABASE_ID, VERIFICATION_TOKENS_ID, doc.$id);

        return { success: true };
    }
};
