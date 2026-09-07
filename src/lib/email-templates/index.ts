export { getEmailSafeLogoUrl, getPublicFileUrl } from "./utils";
export { taskAssignedTemplate } from "./task-assigned";
export { taskStatusChangedTemplate } from "./task-status-changed";
export { taskCompletedTemplate } from "./task-completed";
export { taskUpdatedTemplate } from "./task-updated";
export { taskPriorityChangedTemplate } from "./task-priority-changed";
export { taskDueDateChangedTemplate } from "./task-due-date-changed";

// Workitem lifecycle email templates
export { workitemDueSoonTemplate } from "./workitem-due-soon";
export { workitemOverdueTemplate } from "./workitem-overdue";
export { workitemMentionTemplate } from "./workitem-mention";
export { commentReplyTemplate } from "./comment-reply";
export { standinApprovalTemplate } from "./standin-approval";

// Auth & Organization email templates
export { welcomeEmailTemplate } from "./welcome-email";
export { verifyEmailTemplate } from "./verify-email";
export { twoFactorOtpTemplate } from "./two-factor-otp";

export * from "./base";
// Theme exports - use specific imports from ./theme to avoid conflicts with base
export {
    colors,
    typography,
    statusColors,
    priorityColors,
    branding,
    createEmailWrapper,
    createPrimaryButton,
    createSecondaryButton,
    createNotificationBadge,
    createContentCard,
    createAlertBox,
    createDivider,
} from "./theme";
